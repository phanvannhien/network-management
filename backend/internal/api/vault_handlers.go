package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Password vault (P2-02 device credentials, P2-03 cloud accounts; ADR-018, ADR-045). Secrets are envelope-encrypted
// with an AAD bound to the row; they never appear in lists, details, audit or logs. Anyone in the organization sees
// names, users and devices; owners / admins / credential.manage write; owners / admins / credential.reveal see a
// secret, with an MFA code entered in the last five minutes, and every look is audited.

// revealLimit slows a mass dump from a hijacked session: at most 30 looks a minute per user.
var revealLimit = auth.NewRateLimiter(30, time.Minute)

const (
	revealWindow      = 5 * time.Minute
	clipboardSeconds  = 30
	msgVaultManage    = "Cần quyền quản lý mật khẩu (chủ sở hữu, quản trị hoặc credential.manage)"
	msgVaultReveal    = "Cần quyền xem mật khẩu (chủ sở hữu, quản trị hoặc credential.reveal)"
	msgCredentialGone = "Không tìm thấy mật khẩu"
	msgCloudGone      = "Không tìm thấy tài khoản cloud"
)

func canManageVault(m tenant.Membership) bool { return m.CanAdmin() || m.Has("credential.manage") }
func canRevealVault(m tenant.Membership) bool { return m.CanAdmin() || m.Has("credential.reveal") }

func credentialAAD(id pgtype.UUID) []byte { return secrets.CredentialAAD(uuidStr(id)) }
func cloudAAD(id pgtype.UUID) []byte      { return secrets.CloudAccountAAD(uuidStr(id)) }

// recentMFA: 0 when the session confirmed MFA within the reveal window; 403 when the account has no MFA (nothing to
// confirm — set it up first); 428 when a fresh code is needed.
func recentMFA(ctx context.Context) (int, string) {
	sess, _ := sessionFrom(ctx)
	switch {
	case !sess.MFAEnabled:
		return 403, "Cần bật xác thực hai lớp (MFA) cho tài khoản trước khi xem mật khẩu"
	case sess.MFAVerifiedAt.IsZero() || time.Since(sess.MFAVerifiedAt) > revealWindow:
		return 428, "Nhập mã MFA để xác nhận trước khi xem mật khẩu"
	}
	return 0, ""
}

// sealed is a secret ready for its columns (all empty = no secret).
type sealed struct {
	ct, dek []byte
	ver     pgtype.Int2
}

func sealSecret(keys *secrets.Keyring, plain string, aad []byte) (sealed, error) {
	if plain == "" {
		return sealed{}, nil
	}
	s, err := keys.Seal([]byte(plain), aad)
	if err != nil {
		return sealed{}, fmt.Errorf("seal secret: %w", err)
	}
	return sealed{ct: s.Ciphertext, dek: s.WrappedDEK, ver: pgtype.Int2{Int16: s.KeyVersion, Valid: true}}, nil
}

// rawSecret is a secret exactly as typed: spaces count in a password.
func rawSecret(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func trimmed(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

// ---- credentials ----

func credentialView(r store.ListCredentialsRow) apigen.Credential {
	c := apigen.Credential{Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Kind: apigen.CredentialKind(r.Kind), Username: r.Username,
		HasSecret: r.HasSecret, LastRotatedOn: apiDate(r.LastRotatedOn), DeviceCount: int(r.DeviceCount), Notes: r.Notes,
		Version: int(r.Version)}
	if r.RotateDays.Valid {
		d := int(r.RotateDays.Int32)
		c.RotateDays = &d
		if r.LastRotatedOn.Valid {
			c.RotateDue = apiDate(pgtype.Date{Time: r.LastRotatedOn.Time.AddDate(0, 0, d), Valid: true})
		}
	}
	return c
}

func (s *Server) ListCredentials(ctx context.Context, req apigen.ListCredentialsRequestObject) (apigen.ListCredentialsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	p := store.ListCredentialsParams{OrganizationID: m.OrgID, Q: escapeLike(trimmed(req.Params.Q))}
	if req.Params.DeviceId != nil {
		p.DeviceID = pgUUID(*req.Params.DeviceId)
	}
	rows, err := s.q.ListCredentials(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("list credentials: %w", err)
	}
	out := apigen.ListCredentials200JSONResponse{Credentials: make([]apigen.Credential, 0, len(rows))}
	for _, r := range rows {
		out.Credentials = append(out.Credentials, credentialView(r))
	}
	return out, nil
}

func credentialDetail(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (apigen.CredentialDetail, bool, error) {
	rows, err := q.ListCredentials(ctx, store.ListCredentialsParams{OrganizationID: m.OrgID, CredentialID: id})
	if err != nil {
		return apigen.CredentialDetail{}, false, fmt.Errorf("get credential: %w", err)
	}
	if len(rows) != 1 {
		return apigen.CredentialDetail{}, false, nil
	}
	devs, err := q.CredentialDevices(ctx, store.CredentialDevicesParams{OrganizationID: m.OrgID, CredentialID: id})
	if err != nil {
		return apigen.CredentialDetail{}, false, fmt.Errorf("credential devices: %w", err)
	}
	out := apigen.CredentialDetail{Credential: credentialView(rows[0]), Devices: make([]apigen.CredentialDevice, 0, len(devs))}
	for _, d := range devs {
		out.Devices = append(out.Devices, apigen.CredentialDevice{DeviceId: uuid.UUID(d.DeviceID.Bytes), Hostname: d.Hostname,
			SiteCode: d.SiteCode, Type: apigen.DeviceType(d.Type), Purpose: d.Purpose})
	}
	return out, true, nil
}

func (s *Server) GetCredential(ctx context.Context, req apigen.GetCredentialRequestObject) (apigen.GetCredentialResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := credentialDetail(ctx, s.q, m, pgUUID(req.CredentialId))
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetCredential404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCredentialGone)}, nil
	}
	return apigen.GetCredential200JSONResponse(d), nil
}

// credentialInput is a validated credential body.
type credentialInput struct {
	name, kind, username, notes string
	secret                      *string
	rotateDays                  pgtype.Int4
	lastRotated                 pgtype.Date
	deviceIDs                   []pgtype.UUID
	purposes                    []string
	version                     int32
}

func credentialFields(b *apigen.CredentialInput) (credentialInput, string) {
	if b == nil {
		return credentialInput{}, "Thiếu dữ liệu"
	}
	c := credentialInput{name: strings.TrimSpace(b.Name), kind: string(b.Kind), username: trimmed(b.Username), notes: trimmed(b.Notes),
		secret: b.Secret, lastRotated: pgDate(b.LastRotatedOn)}
	if b.RotateDays != nil {
		c.rotateDays = pgtype.Int4{Int32: int32(*b.RotateDays), Valid: true}
	}
	if b.Version != nil {
		c.version = int32(*b.Version)
	}
	switch {
	case !b.Kind.Valid():
		return c, "Loại mật khẩu không hợp lệ"
	case c.name == "" || tooLong(c.name, 200):
		return c, "Tên từ 1 đến 200 ký tự"
	case tooLong(c.username, 200) || tooLong(c.notes, 4000):
		return c, "Có ô quá dài"
	case b.Secret != nil && tooLong(*b.Secret, 2000):
		return c, "Mật khẩu tối đa 2000 ký tự"
	case b.RotateDays != nil && (*b.RotateDays < 1 || *b.RotateDays > 3650):
		return c, "Chu kỳ đổi từ 1 đến 3650 ngày"
	case len(b.Devices) > 1000:
		return c, "Tối đa 1000 thiết bị"
	}
	seen := map[uuid.UUID]bool{}
	for _, d := range b.Devices {
		if seen[d.DeviceId] {
			continue
		}
		seen[d.DeviceId] = true
		purpose := trimmed(d.Purpose)
		if tooLong(purpose, 50) {
			return c, "Mục đích tối đa 50 ký tự"
		}
		c.deviceIDs = append(c.deviceIDs, pgUUID(d.DeviceId))
		c.purposes = append(c.purposes, purpose)
	}
	return c, ""
}

// setCredentialDevices replaces the devices of a credential; every device must be live in the organization.
func setCredentialDevices(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID, c credentialInput) (string, error) {
	if len(c.deviceIDs) > 0 {
		n, err := q.CountLiveDevicesIn(ctx, store.CountLiveDevicesInParams{OrganizationID: m.OrgID, Ids: c.deviceIDs})
		if err != nil {
			return "", fmt.Errorf("check devices: %w", err)
		}
		if int(n) != len(c.deviceIDs) {
			return "Có thiết bị không thuộc tổ chức này", nil
		}
	}
	if err := q.DeleteCredentialDevices(ctx, store.DeleteCredentialDevicesParams{OrganizationID: m.OrgID, CredentialID: id}); err != nil {
		return "", fmt.Errorf("clear devices: %w", err)
	}
	if len(c.deviceIDs) > 0 {
		if err := q.AddCredentialDevices(ctx, store.AddCredentialDevicesParams{OrganizationID: m.OrgID, CredentialID: id,
			DeviceIds: c.deviceIDs, Purposes: c.purposes}); err != nil {
			return "", fmt.Errorf("add devices: %w", err)
		}
	}
	return "", nil
}

// credentialAudit: what the audit keeps — never the secret, only whether there is one and whether it changed.
func credentialAudit(name, kind, username string, hasSecret, changed bool, rotate pgtype.Int4, last pgtype.Date, devices []pgtype.UUID) map[string]any {
	ids := make([]string, 0, len(devices))
	for _, d := range devices {
		ids = append(ids, uuidStr(d))
	}
	out := map[string]any{"name": name, "kind": kind, "username": username, "hasSecret": hasSecret, "lastRotatedOn": dateStr(last), "deviceIds": ids}
	if rotate.Valid {
		out["rotateDays"] = rotate.Int32
	}
	if changed {
		out["secretChanged"] = true
	}
	return out
}

func (s *Server) CreateCredential(ctx context.Context, req apigen.CreateCredentialRequestObject) (apigen.CreateCredentialResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.CreateCredential403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	c, msg := credentialFields(req.Body)
	if msg != "" {
		return apigen.CreateCredential400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := pgUUID(uuid.New())
	sec, err := sealSecret(s.auth.Keyring(), rawSecret(c.secret), credentialAAD(id))
	if err != nil {
		return nil, err
	}
	if sec.ct != nil && !c.lastRotated.Valid {
		c.lastRotated = pgtype.Date{Time: calendarToday(), Valid: true}
	}
	var detail apigen.CredentialDetail
	dup := false
	err = s.withTx(ctx, func(q store.Querier) error {
		if _, err := q.CreateCredential(ctx, store.CreateCredentialParams{ID: id, OrganizationID: m.OrgID, Name: c.name, Kind: c.kind,
			Username: c.username, SecretCiphertext: sec.ct, SecretWrappedDek: sec.dek, SecretKeyVersion: sec.ver,
			RotateDays: c.rotateDays, LastRotatedOn: c.lastRotated, Notes: c.notes}); isUnique(err) {
			dup = true
			return errRollback
		} else if err != nil {
			return fmt.Errorf("create credential: %w", err)
		}
		if msg, err = setCredentialDevices(ctx, q, m, id, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "credential.create", ObjectType: "credential",
			ObjectID: uuidStr(id), After: credentialAudit(c.name, c.kind, c.username, sec.ct != nil, false, c.rotateDays, c.lastRotated, c.deviceIDs),
			Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		var ok bool
		detail, ok, err = credentialDetail(ctx, q, m, id)
		if err == nil && !ok {
			err = errors.New("credential vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	switch {
	case dup:
		return apigen.CreateCredential409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có mật khẩu tên này"}}, nil
	case msg != "":
		return apigen.CreateCredential400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.CreateCredential201JSONResponse(detail), nil
}

func (s *Server) UpdateCredential(ctx context.Context, req apigen.UpdateCredentialRequestObject) (apigen.UpdateCredentialResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.UpdateCredential403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	c, msg := credentialFields(req.Body)
	if msg == "" && req.Body.Version == nil {
		msg = "Thiếu version"
	}
	if msg != "" {
		return apigen.UpdateCredential400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := pgUUID(req.CredentialId)
	keep := c.secret == nil
	var sec sealed
	if !keep {
		if sec, err = sealSecret(s.auth.Keyring(), *c.secret, credentialAAD(id)); err != nil {
			return nil, err
		}
		if sec.ct != nil {
			// A new secret is a rotation: last change today (unless the form says when it really happened).
			if !c.lastRotated.Valid || req.Body.LastRotatedOn == nil {
				c.lastRotated = pgtype.Date{Time: calendarToday(), Valid: true}
			}
		}
	}
	var detail apigen.CredentialDetail
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetCredentialMeta(ctx, store.GetCredentialMetaParams{OrganizationID: m.OrgID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get credential: %w", err)
		}
		oldDevs, err := q.CredentialDevices(ctx, store.CredentialDevicesParams{OrganizationID: m.OrgID, CredentialID: id})
		if err != nil {
			return fmt.Errorf("credential devices: %w", err)
		}
		_, err = q.UpdateCredential(ctx, store.UpdateCredentialParams{OrganizationID: m.OrgID, ID: id, Version: c.version,
			Name: c.name, Kind: c.kind, Username: c.username, KeepSecret: keep, SecretCiphertext: sec.ct, SecretWrappedDek: sec.dek,
			SecretKeyVersion: sec.ver, RotateDays: c.rotateDays, LastRotatedOn: c.lastRotated, Notes: c.notes})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			code = 409
			return errRollback
		case isUnique(err):
			code = 4091
			return errRollback
		case err != nil:
			return fmt.Errorf("update credential: %w", err)
		}
		if msg, err = setCredentialDevices(ctx, q, m, id, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		oldIDs := make([]pgtype.UUID, 0, len(oldDevs))
		for _, d := range oldDevs {
			oldIDs = append(oldIDs, d.DeviceID)
		}
		hasSecret := before.HasSecret
		if !keep {
			hasSecret = sec.ct != nil
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "credential.update", ObjectType: "credential",
			ObjectID: uuidStr(id),
			Before:   credentialAudit(before.Name, before.Kind, before.Username, before.HasSecret, false, before.RotateDays, before.LastRotatedOn, oldIDs),
			After:    credentialAudit(c.name, c.kind, c.username, hasSecret, !keep, c.rotateDays, c.lastRotated, c.deviceIDs),
			Meta:     infoFrom(ctx).meta}); err != nil {
			return err
		}
		var ok bool
		detail, ok, err = credentialDetail(ctx, q, m, id)
		if err == nil && !ok {
			err = errors.New("credential vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	switch {
	case code == 404:
		return apigen.UpdateCredential404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCredentialGone)}, nil
	case code == 409:
		return apigen.UpdateCredential409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgStale}}, nil
	case code == 4091:
		return apigen.UpdateCredential409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có mật khẩu tên này"}}, nil
	case msg != "":
		return apigen.UpdateCredential400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.UpdateCredential200JSONResponse(detail), nil
}

func (s *Server) DeleteCredential(ctx context.Context, req apigen.DeleteCredentialRequestObject) (apigen.DeleteCredentialResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.DeleteCredential403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		c, err := q.GetCredentialMeta(ctx, store.GetCredentialMetaParams{OrganizationID: m.OrgID, ID: pgUUID(req.CredentialId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get credential: %w", err)
		}
		if _, err := q.SoftDeleteCredential(ctx, store.SoftDeleteCredentialParams{OrganizationID: m.OrgID, ID: c.ID}); err != nil {
			return fmt.Errorf("delete credential: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "credential.delete", ObjectType: "credential",
			ObjectID: uuidStr(c.ID), Before: credentialAudit(c.Name, c.Kind, c.Username, c.HasSecret, false, c.RotateDays, c.LastRotatedOn, nil),
			Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.DeleteCredential404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCredentialGone)}, nil
	}
	return apigen.DeleteCredential204Response{}, nil
}

// reveal opens a stored secret after the permission and MFA checks, and audits the look.
type revealOutcome struct {
	secret  string
	code    int // 403, 404, 428
	message string
}

func (s *Server) reveal(ctx context.Context, m tenant.Membership, action apigen.RevealRequestAction, objectType string, id pgtype.UUID,
	load func(q store.Querier) (name string, ct, dek []byte, ver pgtype.Int2, err error), aad []byte) (revealOutcome, error) {
	if !canRevealVault(m) {
		return revealOutcome{code: 403, message: msgVaultReveal}, nil
	}
	if code, msg := recentMFA(ctx); code != 0 {
		return revealOutcome{code: code, message: msg}, nil
	}
	if !revealLimit.Allow("reveal:" + uuidStr(m.UserID)) {
		return revealOutcome{code: 429, message: "Xem quá nhiều mật khẩu trong thời gian ngắn — đợi một phút"}, nil
	}
	if !action.Valid() {
		action = apigen.Reveal
	}
	name, ct, dek, ver, err := load(s.q)
	if errors.Is(err, pgx.ErrNoRows) {
		return revealOutcome{code: 404}, nil
	}
	if err != nil {
		return revealOutcome{}, fmt.Errorf("load secret: %w", err)
	}
	if ct == nil {
		return revealOutcome{code: 404, message: "Mục này chưa lưu mật khẩu"}, nil
	}
	plain, err := s.auth.Keyring().Open(secrets.Sealed{Ciphertext: ct, WrappedDEK: dek, KeyVersion: ver.Int16}, aad)
	if err != nil {
		return revealOutcome{}, fmt.Errorf("open secret %s %s: %w", objectType, uuidStr(id), err)
	}
	// Who, when, what and from where; never the secret itself.
	if err := audit.Write(ctx, s.q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: objectType + "." + string(action),
		ObjectType: objectType, ObjectID: uuidStr(id), After: map[string]any{"name": name}, Meta: infoFrom(ctx).meta}); err != nil {
		return revealOutcome{}, err
	}
	return revealOutcome{secret: string(plain)}, nil
}

func (s *Server) RevealCredential(ctx context.Context, req apigen.RevealCredentialRequestObject) (apigen.RevealCredentialResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	id := pgUUID(req.CredentialId)
	var action apigen.RevealRequestAction
	if req.Body != nil {
		action = req.Body.Action
	}
	out, err := s.reveal(ctx, m, action, "credential", id, func(q store.Querier) (string, []byte, []byte, pgtype.Int2, error) {
		r, err := q.GetCredentialSecret(ctx, store.GetCredentialSecretParams{OrganizationID: m.OrgID, ID: id})
		return r.Name, r.SecretCiphertext, r.SecretWrappedDek, r.SecretKeyVersion, err
	}, credentialAAD(id))
	if err != nil {
		return nil, err
	}
	switch out.code {
	case 403:
		return apigen.RevealCredential403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: out.message}}, nil
	case 428:
		return apigen.RevealCredential428JSONResponse{Message: out.message}, nil
	case 429:
		return apigen.RevealCredential429JSONResponse{Message: out.message}, nil
	case 404:
		return apigen.RevealCredential404JSONResponse{NotFoundJSONResponse: notFoundBody(firstNonEmpty(out.message, msgCredentialGone))}, nil
	}
	noStore := "no-store"
	return apigen.RevealCredential200JSONResponse{Body: apigen.RevealResult{Secret: out.secret, ClearAfterSeconds: clipboardSeconds},
		Headers: apigen.RevealCredential200ResponseHeaders{CacheControl: &noStore}}, nil
}

// ---- cloud accounts ----

func cloudView(r store.ListCloudAccountsRow) apigen.CloudAccount {
	return apigen.CloudAccount{Id: uuid.UUID(r.ID.Bytes), Provider: apigen.CloudProvider(r.Provider), Name: r.Name, PortalUrl: r.PortalUrl,
		Username: r.Username, HasSecret: r.HasSecret, MfaHolder: r.MfaHolder, Plan: r.Plan, ExpiresOn: apiDate(r.ExpiresOn),
		VendorId: optUUID(r.VendorID), VendorName: r.VendorName, DeviceCount: int(r.DeviceCount), Notes: r.Notes, Version: int(r.Version)}
}

func (s *Server) ListCloudAccounts(ctx context.Context, req apigen.ListCloudAccountsRequestObject) (apigen.ListCloudAccountsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	p := store.ListCloudAccountsParams{OrganizationID: m.OrgID, Q: escapeLike(trimmed(req.Params.Q))}
	if req.Params.DeviceId != nil {
		p.DeviceID = pgUUID(*req.Params.DeviceId)
	}
	rows, err := s.q.ListCloudAccounts(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("list cloud accounts: %w", err)
	}
	out := apigen.ListCloudAccounts200JSONResponse{Accounts: make([]apigen.CloudAccount, 0, len(rows))}
	for _, r := range rows {
		out.Accounts = append(out.Accounts, cloudView(r))
	}
	return out, nil
}

func cloudDetail(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (apigen.CloudAccountDetail, bool, error) {
	rows, err := q.ListCloudAccounts(ctx, store.ListCloudAccountsParams{OrganizationID: m.OrgID, AccountID: id})
	if err != nil {
		return apigen.CloudAccountDetail{}, false, fmt.Errorf("get cloud account: %w", err)
	}
	if len(rows) != 1 {
		return apigen.CloudAccountDetail{}, false, nil
	}
	devs, err := q.CloudAccountDevices(ctx, store.CloudAccountDevicesParams{OrganizationID: m.OrgID, CloudAccountID: id})
	if err != nil {
		return apigen.CloudAccountDetail{}, false, fmt.Errorf("cloud account devices: %w", err)
	}
	out := apigen.CloudAccountDetail{Account: cloudView(rows[0]), Devices: make([]apigen.CloudAccountDevice, 0, len(devs))}
	for _, d := range devs {
		out.Devices = append(out.Devices, apigen.CloudAccountDevice{DeviceId: uuid.UUID(d.DeviceID.Bytes), Hostname: d.Hostname,
			SiteCode: d.SiteCode, Type: apigen.DeviceType(d.Type)})
	}
	return out, true, nil
}

func (s *Server) GetCloudAccount(ctx context.Context, req apigen.GetCloudAccountRequestObject) (apigen.GetCloudAccountResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := cloudDetail(ctx, s.q, m, pgUUID(req.AccountId))
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetCloudAccount404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCloudGone)}, nil
	}
	return apigen.GetCloudAccount200JSONResponse(d), nil
}

type cloudInput struct {
	provider, name, portal, username, mfaHolder, plan, notes string
	secret                                                   *string
	expires                                                  pgtype.Date
	vendor                                                   pgtype.UUID
	deviceIDs                                                []pgtype.UUID
	version                                                  int32
}

func cloudFields(b *apigen.CloudAccountInput) (cloudInput, string) {
	if b == nil {
		return cloudInput{}, "Thiếu dữ liệu"
	}
	c := cloudInput{provider: string(b.Provider), name: strings.TrimSpace(b.Name), portal: trimmed(b.PortalUrl), username: trimmed(b.Username),
		mfaHolder: trimmed(b.MfaHolder), plan: trimmed(b.Plan), notes: trimmed(b.Notes), secret: b.Secret, expires: pgDate(b.ExpiresOn)}
	if b.VendorId != nil {
		c.vendor = pgUUID(*b.VendorId)
	}
	if b.Version != nil {
		c.version = int32(*b.Version)
	}
	switch {
	case !b.Provider.Valid():
		return c, "Nhà cung cấp cloud không hợp lệ"
	case c.name == "" || tooLong(c.name, 200):
		return c, "Tên từ 1 đến 200 ký tự"
	case !webURL(c.portal):
		return c, "Địa chỉ portal phải dạng https://…"
	case tooLong(c.username, 320) || tooLong(c.mfaHolder, 200) || tooLong(c.plan, 200) || tooLong(c.notes, 4000):
		return c, "Có ô quá dài"
	case b.Secret != nil && tooLong(*b.Secret, 2000):
		return c, "Mật khẩu tối đa 2000 ký tự"
	case len(b.DeviceIds) > 1000:
		return c, "Tối đa 1000 thiết bị"
	}
	for _, id := range uniqueIDs(b.DeviceIds) {
		c.deviceIDs = append(c.deviceIDs, pgUUID(id))
	}
	return c, ""
}

// checkCloudRefs: the vendor and devices must be of the organization.
func checkCloudRefs(ctx context.Context, q store.Querier, m tenant.Membership, c cloudInput) (string, error) {
	if c.vendor.Valid {
		if _, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: c.vendor}); errors.Is(err, pgx.ErrNoRows) {
			return "Nhà cung cấp không thuộc tổ chức này", nil
		} else if err != nil {
			return "", fmt.Errorf("get vendor: %w", err)
		}
	}
	if len(c.deviceIDs) > 0 {
		n, err := q.CountLiveDevicesIn(ctx, store.CountLiveDevicesInParams{OrganizationID: m.OrgID, Ids: c.deviceIDs})
		if err != nil {
			return "", fmt.Errorf("check devices: %w", err)
		}
		if int(n) != len(c.deviceIDs) {
			return "Có thiết bị không thuộc tổ chức này", nil
		}
	}
	return "", nil
}

func cloudAudit(c cloudInput, hasSecret, changed bool) map[string]any {
	ids := make([]string, 0, len(c.deviceIDs))
	for _, d := range c.deviceIDs {
		ids = append(ids, uuidStr(d))
	}
	out := map[string]any{"provider": c.provider, "name": c.name, "portalUrl": c.portal, "username": c.username, "mfaHolder": c.mfaHolder,
		"plan": c.plan, "expiresOn": dateStr(c.expires), "vendorId": uuidStr(c.vendor), "hasSecret": hasSecret, "deviceIds": ids}
	if changed {
		out["secretChanged"] = true
	}
	return out
}

func (s *Server) CreateCloudAccount(ctx context.Context, req apigen.CreateCloudAccountRequestObject) (apigen.CreateCloudAccountResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.CreateCloudAccount403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	c, msg := cloudFields(req.Body)
	if msg != "" {
		return apigen.CreateCloudAccount400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := pgUUID(uuid.New())
	sec, err := sealSecret(s.auth.Keyring(), rawSecret(c.secret), cloudAAD(id))
	if err != nil {
		return nil, err
	}
	var detail apigen.CloudAccountDetail
	dup := false
	err = s.withTx(ctx, func(q store.Querier) error {
		if msg, err = checkCloudRefs(ctx, q, m, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		if _, err := q.CreateCloudAccount(ctx, store.CreateCloudAccountParams{ID: id, OrganizationID: m.OrgID, Provider: c.provider, Name: c.name,
			PortalUrl: c.portal, Username: c.username, SecretCiphertext: sec.ct, SecretWrappedDek: sec.dek, SecretKeyVersion: sec.ver,
			MfaHolder: c.mfaHolder, Plan: c.plan, ExpiresOn: c.expires, VendorID: c.vendor, Notes: c.notes}); isUnique(err) {
			dup = true
			return errRollback
		} else if err != nil {
			return fmt.Errorf("create cloud account: %w", err)
		}
		if len(c.deviceIDs) > 0 {
			if err := q.AddCloudAccountDevices(ctx, store.AddCloudAccountDevicesParams{OrganizationID: m.OrgID, CloudAccountID: id, DeviceIds: c.deviceIDs}); err != nil {
				return fmt.Errorf("add devices: %w", err)
			}
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "cloud_account.create", ObjectType: "cloud_account",
			ObjectID: uuidStr(id), After: cloudAudit(c, sec.ct != nil, false), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		var ok bool
		detail, ok, err = cloudDetail(ctx, q, m, id)
		if err == nil && !ok {
			err = errors.New("cloud account vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	switch {
	case dup:
		return apigen.CreateCloudAccount409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có tài khoản tên này"}}, nil
	case msg != "":
		return apigen.CreateCloudAccount400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.CreateCloudAccount201JSONResponse(detail), nil
}

func (s *Server) UpdateCloudAccount(ctx context.Context, req apigen.UpdateCloudAccountRequestObject) (apigen.UpdateCloudAccountResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.UpdateCloudAccount403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	c, msg := cloudFields(req.Body)
	if msg == "" && req.Body.Version == nil {
		msg = "Thiếu version"
	}
	if msg != "" {
		return apigen.UpdateCloudAccount400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := pgUUID(req.AccountId)
	keep := c.secret == nil
	var sec sealed
	if !keep {
		if sec, err = sealSecret(s.auth.Keyring(), *c.secret, cloudAAD(id)); err != nil {
			return nil, err
		}
	}
	var detail apigen.CloudAccountDetail
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		if _, err := q.GetCloudAccountMeta(ctx, store.GetCloudAccountMetaParams{OrganizationID: m.OrgID, ID: id}); errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		} else if err != nil {
			return fmt.Errorf("get cloud account: %w", err)
		}
		before, ok, err := cloudDetail(ctx, q, m, id)
		if err != nil || !ok {
			if err == nil {
				err = errors.New("cloud account vanished")
			}
			return err
		}
		if msg, err = checkCloudRefs(ctx, q, m, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		_, err = q.UpdateCloudAccount(ctx, store.UpdateCloudAccountParams{OrganizationID: m.OrgID, ID: id, Version: c.version, Provider: c.provider,
			Name: c.name, PortalUrl: c.portal, Username: c.username, KeepSecret: keep, SecretCiphertext: sec.ct, SecretWrappedDek: sec.dek,
			SecretKeyVersion: sec.ver, MfaHolder: c.mfaHolder, Plan: c.plan, ExpiresOn: c.expires, VendorID: c.vendor, Notes: c.notes})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			code = 409
			return errRollback
		case isUnique(err):
			code = 4091
			return errRollback
		case err != nil:
			return fmt.Errorf("update cloud account: %w", err)
		}
		if err := q.DeleteCloudAccountDevices(ctx, store.DeleteCloudAccountDevicesParams{OrganizationID: m.OrgID, CloudAccountID: id}); err != nil {
			return fmt.Errorf("clear devices: %w", err)
		}
		if len(c.deviceIDs) > 0 {
			if err := q.AddCloudAccountDevices(ctx, store.AddCloudAccountDevicesParams{OrganizationID: m.OrgID, CloudAccountID: id, DeviceIds: c.deviceIDs}); err != nil {
				return fmt.Errorf("add devices: %w", err)
			}
		}
		b := before.Account
		prev := cloudInput{provider: string(b.Provider), name: b.Name, portal: b.PortalUrl, username: b.Username, mfaHolder: b.MfaHolder,
			plan: b.Plan, notes: b.Notes, expires: pgDate(b.ExpiresOn)}
		if b.VendorId != nil {
			prev.vendor = pgUUID(*b.VendorId)
		}
		for _, d := range before.Devices {
			prev.deviceIDs = append(prev.deviceIDs, pgUUID(d.DeviceId))
		}
		hasSecret := b.HasSecret
		if !keep {
			hasSecret = sec.ct != nil
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "cloud_account.update", ObjectType: "cloud_account",
			ObjectID: uuidStr(id), Before: cloudAudit(prev, b.HasSecret, false), After: cloudAudit(c, hasSecret, !keep), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		detail, ok, err = cloudDetail(ctx, q, m, id)
		if err == nil && !ok {
			err = errors.New("cloud account vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	switch {
	case code == 404:
		return apigen.UpdateCloudAccount404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCloudGone)}, nil
	case code == 409:
		return apigen.UpdateCloudAccount409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgStale}}, nil
	case code == 4091:
		return apigen.UpdateCloudAccount409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có tài khoản tên này"}}, nil
	case msg != "":
		return apigen.UpdateCloudAccount400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.UpdateCloudAccount200JSONResponse(detail), nil
}

func (s *Server) DeleteCloudAccount(ctx context.Context, req apigen.DeleteCloudAccountRequestObject) (apigen.DeleteCloudAccountResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageVault(m) {
		return apigen.DeleteCloudAccount403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVaultManage}}, nil
	}
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		a, err := q.GetCloudAccountMeta(ctx, store.GetCloudAccountMetaParams{OrganizationID: m.OrgID, ID: pgUUID(req.AccountId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get cloud account: %w", err)
		}
		if _, err := q.SoftDeleteCloudAccount(ctx, store.SoftDeleteCloudAccountParams{OrganizationID: m.OrgID, ID: a.ID}); err != nil {
			return fmt.Errorf("delete cloud account: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "cloud_account.delete", ObjectType: "cloud_account",
			ObjectID: uuidStr(a.ID), Before: map[string]any{"provider": a.Provider, "name": a.Name, "username": a.Username}, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.DeleteCloudAccount404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCloudGone)}, nil
	}
	return apigen.DeleteCloudAccount204Response{}, nil
}

func (s *Server) RevealCloudAccount(ctx context.Context, req apigen.RevealCloudAccountRequestObject) (apigen.RevealCloudAccountResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	id := pgUUID(req.AccountId)
	var action apigen.RevealRequestAction
	if req.Body != nil {
		action = req.Body.Action
	}
	out, err := s.reveal(ctx, m, action, "cloud_account", id, func(q store.Querier) (string, []byte, []byte, pgtype.Int2, error) {
		r, err := q.GetCloudAccountSecret(ctx, store.GetCloudAccountSecretParams{OrganizationID: m.OrgID, ID: id})
		return r.Name, r.SecretCiphertext, r.SecretWrappedDek, r.SecretKeyVersion, err
	}, cloudAAD(id))
	if err != nil {
		return nil, err
	}
	switch out.code {
	case 403:
		return apigen.RevealCloudAccount403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: out.message}}, nil
	case 428:
		return apigen.RevealCloudAccount428JSONResponse{Message: out.message}, nil
	case 429:
		return apigen.RevealCloudAccount429JSONResponse{Message: out.message}, nil
	case 404:
		return apigen.RevealCloudAccount404JSONResponse{NotFoundJSONResponse: notFoundBody(firstNonEmpty(out.message, msgCloudGone))}, nil
	}
	noStore := "no-store"
	return apigen.RevealCloudAccount200JSONResponse{Body: apigen.RevealResult{Secret: out.secret, ClearAfterSeconds: clipboardSeconds},
		Headers: apigen.RevealCloudAccount200ResponseHeaders{CacheControl: &noStore}}, nil
}
