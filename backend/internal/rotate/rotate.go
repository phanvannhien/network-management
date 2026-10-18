// Package rotate moves every stored secret to a new master key (P2-02, ADR-018 / ADR-045): data keys are unwrapped
// with the old key and wrapped with the new one in a single transaction; no plaintext secret is handled.
package rotate

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Counts says how many secrets of each kind were moved.
type Counts struct {
	Credentials, CloudAccounts, TOTP, SMTP, BackupTargets int
}

func id(u pgtype.UUID) string { return uuid.UUID(u.Bytes).String() }

// one: exactly the row read was updated (it did not change under us).
func one(n int64, err error) error {
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("the secret changed during the rotation (%d rows)", n)
	}
	return nil
}

// CheckVersions refuses a keyring whose version is not the one every stored secret uses (after a rotation, the new
// key and NTB_MASTER_KEY_VERSION must be set together); no secrets yet is fine.
func CheckVersions(ctx context.Context, q *store.Queries, keys *secrets.Keyring) error {
	versions, err := q.SecretKeyVersions(ctx)
	if err != nil {
		return fmt.Errorf("stored key versions: %w", err)
	}
	for _, v := range versions {
		if v != keys.Version() {
			return fmt.Errorf("stored secrets use master key version(s) %v but NTB_MASTER_KEY_VERSION is %d — set the key and version that match (after a rotation: the new key and the printed version)", versions, keys.Version())
		}
	}
	return nil
}

// Run rewraps everything from old to next. Any secret that does not open with old aborts the whole rotation.
func Run(ctx context.Context, pool *pgxpool.Pool, old, next *secrets.Keyring) (Counts, error) {
	var c Counts
	if old.Version() == next.Version() {
		return c, fmt.Errorf("the new master key needs another version than %d", old.Version())
	}
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// Nothing may write a secret meanwhile (an API left running): a row saved during the rotation would stay on
		// the old key, or get an old data key wrapped over its new one.
		if _, err := tx.Exec(ctx, `LOCK TABLE credentials, cloud_accounts, mfa_totp, smtp_settings IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return fmt.Errorf("lock secret tables: %w", err)
		}
		q := store.New(tx)
		creds, err := q.AllSealedCredentials(ctx)
		if err != nil {
			return fmt.Errorf("load credentials: %w", err)
		}
		for _, r := range creds {
			s, err := old.Rewrap(secrets.Sealed{Ciphertext: r.SecretCiphertext, WrappedDEK: r.SecretWrappedDek, KeyVersion: r.SecretKeyVersion.Int16},
				secrets.CredentialAAD(id(r.ID)), next)
			if err != nil {
				return fmt.Errorf("credential %s: %w", id(r.ID), err)
			}
			if err := one(q.RewrapCredential(ctx, store.RewrapCredentialParams{ID: r.ID, SecretWrappedDek: s.WrappedDEK,
				SecretKeyVersion: pgtype.Int2{Int16: s.KeyVersion, Valid: true}, OldWrappedDek: r.SecretWrappedDek})); err != nil {
				return fmt.Errorf("save credential %s: %w", id(r.ID), err)
			}
			c.Credentials++
		}
		accounts, err := q.AllSealedCloudAccounts(ctx)
		if err != nil {
			return fmt.Errorf("load cloud accounts: %w", err)
		}
		for _, r := range accounts {
			s, err := old.Rewrap(secrets.Sealed{Ciphertext: r.SecretCiphertext, WrappedDEK: r.SecretWrappedDek, KeyVersion: r.SecretKeyVersion.Int16},
				secrets.CloudAccountAAD(id(r.ID)), next)
			if err != nil {
				return fmt.Errorf("cloud account %s: %w", id(r.ID), err)
			}
			if err := one(q.RewrapCloudAccount(ctx, store.RewrapCloudAccountParams{ID: r.ID, SecretWrappedDek: s.WrappedDEK,
				SecretKeyVersion: pgtype.Int2{Int16: s.KeyVersion, Valid: true}, OldWrappedDek: r.SecretWrappedDek})); err != nil {
				return fmt.Errorf("save cloud account %s: %w", id(r.ID), err)
			}
			c.CloudAccounts++
		}
		seeds, err := q.AllSealedTOTP(ctx)
		if err != nil {
			return fmt.Errorf("load totp: %w", err)
		}
		for _, r := range seeds {
			s, err := old.Rewrap(secrets.Sealed{Ciphertext: r.SecretCiphertext, WrappedDEK: r.WrappedDek, KeyVersion: r.KeyVersion},
				secrets.TOTPAAD(id(r.UserID)), next)
			if err != nil {
				return fmt.Errorf("totp of user %s: %w", id(r.UserID), err)
			}
			if err := one(q.RewrapTOTP(ctx, store.RewrapTOTPParams{UserID: r.UserID, WrappedDek: s.WrappedDEK, KeyVersion: s.KeyVersion,
				OldWrappedDek: r.WrappedDek})); err != nil {
				return fmt.Errorf("save totp: %w", err)
			}
			c.TOTP++
		}
		smtp, err := q.SealedSmtpPassword(ctx)
		if err != nil {
			return fmt.Errorf("load smtp password: %w", err)
		}
		for _, r := range smtp {
			s, err := old.Rewrap(secrets.Sealed{Ciphertext: r.PasswordCiphertext, WrappedDEK: r.PasswordWrappedDek, KeyVersion: r.PasswordKeyVersion.Int16},
				secrets.SMTPPasswordAAD, next)
			if err != nil {
				return fmt.Errorf("smtp password: %w", err)
			}
			if err := one(q.RewrapSmtpPassword(ctx, store.RewrapSmtpPasswordParams{PasswordWrappedDek: s.WrappedDEK,
				PasswordKeyVersion: pgtype.Int2{Int16: s.KeyVersion, Valid: true}, OldWrappedDek: r.PasswordWrappedDek})); err != nil {
				return fmt.Errorf("save smtp password: %w", err)
			}
			c.SMTP++
		}
		targets, err := q.AllSealedBackupTargets(ctx)
		if err != nil {
			return fmt.Errorf("load backup destinations: %w", err)
		}
		for _, r := range targets {
			s, err := old.Rewrap(secrets.Sealed{Ciphertext: r.SecretCiphertext, WrappedDEK: r.SecretWrappedDek, KeyVersion: r.SecretKeyVersion.Int16},
				secrets.BackupTargetAAD(id(r.ID)), next)
			if err != nil {
				return fmt.Errorf("backup destination %s: %w", id(r.ID), err)
			}
			if err := one(q.RewrapBackupTarget(ctx, store.RewrapBackupTargetParams{ID: r.ID, SecretWrappedDek: s.WrappedDEK,
				SecretKeyVersion: pgtype.Int2{Int16: s.KeyVersion, Valid: true}, OldWrappedDek: r.SecretWrappedDek})); err != nil {
				return fmt.Errorf("save backup destination: %w", err)
			}
			c.BackupTargets++
		}
		return nil
	})
	return c, err
}
