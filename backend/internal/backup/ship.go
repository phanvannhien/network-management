package backup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// SealedSecret is a destination's secret ready for its columns (all nil = none).
type SealedSecret struct {
	Ciphertext, WrappedDEK []byte
	KeyVersion             pgtype.Int2
}

// SealTargetSecret seals a destination's secrets bound to its id.
func SealTargetSecret(keys *secrets.Keyring, id uuid.UUID, sec TargetSecret) (SealedSecret, error) {
	if sec == (TargetSecret{}) {
		return SealedSecret{}, nil
	}
	plain, err := json.Marshal(sec)
	if err != nil {
		return SealedSecret{}, fmt.Errorf("backup destination secret: %w", err)
	}
	s, err := keys.Seal(plain, secrets.BackupTargetAAD(id.String()))
	if err != nil {
		return SealedSecret{}, fmt.Errorf("seal backup destination secret: %w", err)
	}
	return SealedSecret{Ciphertext: s.Ciphertext, WrappedDEK: s.WrappedDEK, KeyVersion: pgtype.Int2{Int16: s.KeyVersion, Valid: true}}, nil
}

// TargetFromRow turns a stored destination into a Target, opening its secrets.
func TargetFromRow(keys *secrets.Keyring, r store.BackupTarget) (Target, error) {
	id := uuid.UUID(r.ID.Bytes)
	t := Target{ID: id.String(), Name: r.Name, Kind: r.Kind}
	if len(r.Settings) > 0 {
		if err := json.Unmarshal(r.Settings, &t.Settings); err != nil {
			return t, fmt.Errorf("backup destination settings: %w", err)
		}
	}
	keep, err := ParsePolicy(r.Keep)
	if err != nil {
		return t, err
	}
	t.Keep = keep
	if r.SecretCiphertext != nil {
		plain, err := keys.Open(secrets.Sealed{Ciphertext: r.SecretCiphertext, WrappedDEK: r.SecretWrappedDek, KeyVersion: r.SecretKeyVersion.Int16},
			secrets.BackupTargetAAD(id.String()))
		if err != nil {
			return t, fmt.Errorf("open backup destination secret: %w", err)
		}
		if err := json.Unmarshal(plain, &t.Secret); err != nil {
			return t, fmt.Errorf("backup destination secret: %w", err)
		}
	}
	return t, nil
}

// Ship copies a new backup to every enabled destination, records each result, keeps refreshed OAuth tokens and
// e-mails the system admins when a destination turns failed. A failing destination never fails the backup.
func (s *Service) Ship(ctx context.Context, file string) []ShipResult {
	if s.Cfg.Keys == nil {
		return nil
	}
	q := store.New(s.Pool)
	rows, err := q.ListBackupTargets(ctx)
	if err != nil {
		if !strings.Contains(err.Error(), "backup_targets") { // before the migration: no destinations yet
			s.Logger.Warn("backup destinations", "error", err)
		}
		return nil
	}
	var out []ShipResult
	for _, r := range rows {
		if !r.Enabled {
			continue
		}
		t, err := TargetFromRow(s.Cfg.Keys, r)
		var res ShipResult
		if err != nil {
			res = ShipResult{Target: t, Err: err}
		} else {
			res = s.Cfg.Rclone.Ship(ctx, t, filepath.Join(s.Cfg.Dir, file))
		}
		out = append(out, res)
		s.recordShip(ctx, q, r, res, file)
	}
	return out
}

func (s *Service) recordShip(ctx context.Context, q *store.Queries, r store.BackupTarget, res ShipResult, file string) {
	status, msg := "ok", ""
	if res.Err != nil {
		status, msg = "failed", res.Err.Error()
		s.Logger.Error("backup destination failed", "destination", r.Name, "error", res.Err)
	}
	if err := q.RecordBackupTargetResult(ctx, store.RecordBackupTargetResultParams{ID: r.ID, LastStatus: status, LastFile: file, LastError: msg}); err != nil {
		s.Logger.Warn("record backup destination result", "error", err)
	}
	if res.Refreshed != "" {
		sec := res.Target.Secret
		sec.Token = res.Refreshed
		if sealed, err := SealTargetSecret(s.Cfg.Keys, uuid.UUID(r.ID.Bytes), sec); err == nil {
			_ = q.SaveBackupTargetSecret(ctx, store.SaveBackupTargetSecretParams{ID: r.ID, SecretCiphertext: sealed.Ciphertext,
				SecretWrappedDek: sealed.WrappedDEK, SecretKeyVersion: sealed.KeyVersion})
		}
	}
	if status == "failed" && r.LastStatus != "failed" {
		s.notify(ctx, fmt.Sprintf("Sao lưu: không gửi được lên %q", r.Name),
			fmt.Sprintf("Bản sao lưu %s không gửi được lên đích %q:\n\n%s\n\nBản trên máy chủ vẫn còn. Kiểm tra ở Hệ thống → Sao lưu.", file, r.Name, msg))
	}
}

func (s *Service) notify(ctx context.Context, subject, text string) {
	if s.Cfg.Notify == nil {
		return
	}
	if err := s.Cfg.Notify(ctx, subject, text); err != nil && !errors.Is(err, context.Canceled) {
		s.Logger.Warn("backup alert e-mail", "error", err)
	}
}
