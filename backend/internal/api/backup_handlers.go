package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/backup"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// backupStaleAfter: no good backup for this long shows red on the system page.
const backupStaleAfter = 48 * time.Hour

func toBackupRun(r store.BackupRun) apigen.BackupRun {
	out := apigen.BackupRun{
		Id: uuid.UUID(r.ID.Bytes), Kind: apigen.BackupRunKind(r.Kind), Status: apigen.BackupRunStatus(r.Status),
		StartedAt: r.StartedAt.Time, FileName: r.FileName, SizeBytes: r.SizeBytes, Error: r.Error,
		Verified: r.VerifiedAt.Valid && r.VerifyError == "",
	}
	if r.FinishedAt.Valid {
		out.FinishedAt = &r.FinishedAt.Time
	}
	return out
}

// AdminGetBackups shows system admins how backups are set up and how the recent ones went (P2-13). Paths and
// passphrases never leave the server beyond the directory name.
func (s *Server) AdminGetBackups(ctx context.Context, _ apigen.AdminGetBackupsRequestObject) (apigen.AdminGetBackupsResponseObject, error) {
	fingerprint := s.backups.KeyFingerprint
	out := apigen.BackupStatus{
		Enabled: s.backups.Enabled, Dir: s.backups.Dir, Schedule: s.backups.Schedule, Keep: s.backups.Keep,
		Runs: []apigen.BackupRun{}, Files: s.backupFiles(fingerprint), Targets: []apigen.BackupTarget{},
	}
	targets, err := s.q.ListBackupTargets(ctx)
	if err != nil {
		return nil, fmt.Errorf("backup destinations: %w", err)
	}
	for _, t := range targets {
		out.Targets = append(out.Targets, toBackupTarget(t))
	}
	runs, err := s.q.ListBackupRuns(ctx, 20)
	if err != nil {
		return nil, fmt.Errorf("backup runs: %w", err)
	}
	for _, r := range runs {
		out.Runs = append(out.Runs, toBackupRun(r))
	}
	last, ok, err := backup.LastGood(ctx, s.q)
	if err != nil {
		return nil, err
	}
	if ok {
		v := toBackupRun(last)
		out.LastGood = &v
	}
	out.Stale = backup.Stale(last.StartedAt, ok, backupStaleAfter, time.Now())
	return apigen.AdminGetBackups200JSONResponse(out), nil
}

// --- destinations (P2-13 step 2) ---

func settingsFrom(in apigen.BackupTargetSettings) backup.TargetSettings {
	v := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	out := backup.TargetSettings{Path: v(in.Path), Host: v(in.Host), User: v(in.User), HostKey: v(in.HostKey),
		Provider: v(in.Provider), Endpoint: v(in.Endpoint), Region: v(in.Region), Bucket: v(in.Bucket),
		AccessKeyID: v(in.AccessKeyId), DriveID: v(in.DriveId), DriveType: v(in.DriveType)}
	if in.Port != nil {
		out.Port = *in.Port
	}
	return out
}

func settingsView(st backup.TargetSettings) apigen.BackupTargetSettings {
	p := func(v string) *string {
		if v == "" {
			return nil
		}
		return &v
	}
	out := apigen.BackupTargetSettings{Path: p(st.Path), Host: p(st.Host), User: p(st.User), HostKey: p(st.HostKey),
		Provider: p(st.Provider), Endpoint: p(st.Endpoint), Region: p(st.Region), Bucket: p(st.Bucket),
		AccessKeyId: p(st.AccessKeyID), DriveId: p(st.DriveID), DriveType: p(st.DriveType)}
	if st.Port != 0 {
		out.Port = &st.Port
	}
	return out
}

func toBackupTarget(r store.BackupTarget) apigen.BackupTarget {
	var st backup.TargetSettings
	_ = json.Unmarshal(r.Settings, &st)
	out := apigen.BackupTarget{Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Kind: apigen.BackupTargetKind(r.Kind), Enabled: r.Enabled,
		Settings: settingsView(st), Keep: r.Keep, SecretSet: r.SecretCiphertext != nil,
		LastStatus: apigen.BackupTargetLastStatus(r.LastStatus), LastFile: r.LastFile, LastError: r.LastError, Version: int(r.Version)}
	if r.LastAt.Valid {
		out.LastAt = &r.LastAt.Time
	}
	return out
}

// targetSnapshot is what the audit log keeps of a destination: never a secret.
func targetSnapshot(name, kind string, enabled bool, st backup.TargetSettings, keep string) map[string]any {
	return map[string]any{"name": name, "kind": kind, "enabled": enabled, "settings": st, "keep": keep}
}

// mergeSecret applies the secret fields sent (omitted = kept, empty = removed).
func mergeSecret(sec backup.TargetSecret, b apigen.BackupTargetInput) backup.TargetSecret {
	set := func(dst *string, p *string) {
		if p != nil {
			*dst = *p
		}
	}
	set(&sec.Password, b.Password)
	set(&sec.PrivateKey, b.PrivateKey)
	set(&sec.SecretKey, b.SecretKey)
	set(&sec.Token, b.Token)
	return sec
}

// prepareTarget checks a destination and fills what can be found (the OneDrive drive). "" = fine.
func prepareTarget(ctx context.Context, t *backup.Target, keep string) string {
	if strings.TrimSpace(t.Name) == "" {
		return "Thiếu tên đích"
	}
	p, err := backup.ParsePolicy(keep)
	if err != nil {
		return "Số bản giữ lại phải dạng ngày,tuần,tháng (vd 7,4,12)"
	}
	t.Keep = p
	if err := t.Validate(); err != nil {
		return err.Error()
	}
	if t.Kind == backup.KindOneDrive && t.Settings.DriveID == "" {
		id, kind, err := backup.OneDriveDrive(ctx, t.Secret.Token)
		if err != nil {
			return err.Error()
		}
		t.Settings.DriveID, t.Settings.DriveType = id, kind
	}
	return ""
}

func (s *Server) AdminCreateBackupTarget(ctx context.Context, req apigen.AdminCreateBackupTargetRequestObject) (apigen.AdminCreateBackupTargetResponseObject, error) {
	bad := func(msg string) (apigen.AdminCreateBackupTargetResponseObject, error) {
		return apigen.AdminCreateBackupTarget400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil {
		return bad("Thiếu dữ liệu")
	}
	sess, _ := sessionFrom(ctx)
	t := backup.Target{Name: strings.TrimSpace(b.Name), Kind: string(b.Kind), Settings: settingsFrom(b.Settings), Secret: mergeSecret(backup.TargetSecret{}, *b)}
	if msg := prepareTarget(ctx, &t, b.Keep); msg != "" {
		return bad(msg)
	}
	id := uuid.New()
	sealed, err := backup.SealTargetSecret(s.auth.Keyring(), id, t.Secret)
	if err != nil {
		return nil, err
	}
	settings, _ := json.Marshal(t.Settings)
	var row store.BackupTarget
	err = s.withTx(ctx, func(q store.Querier) error {
		var err error
		row, err = q.CreateBackupTarget(ctx, store.CreateBackupTargetParams{ID: pgUUID(id), Name: t.Name, Kind: t.Kind, Enabled: b.Enabled,
			Settings: settings, SecretCiphertext: sealed.Ciphertext, SecretWrappedDek: sealed.WrappedDEK, SecretKeyVersion: sealed.KeyVersion, Keep: b.Keep})
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup_target.create", ObjectType: "backup_target", ObjectID: id.String(),
			After: targetSnapshot(t.Name, t.Kind, b.Enabled, t.Settings, b.Keep), Meta: infoFrom(ctx).meta})
	})
	if isUniqueViolation(err) {
		return apigen.AdminCreateBackupTarget409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có đích cùng tên"}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("create backup destination: %w", err)
	}
	return apigen.AdminCreateBackupTarget201JSONResponse(toBackupTarget(row)), nil
}

func (s *Server) AdminUpdateBackupTarget(ctx context.Context, req apigen.AdminUpdateBackupTargetRequestObject) (apigen.AdminUpdateBackupTargetResponseObject, error) {
	bad := func(msg string) (apigen.AdminUpdateBackupTargetResponseObject, error) {
		return apigen.AdminUpdateBackupTarget400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil || b.Version == nil {
		return bad("Thiếu dữ liệu hoặc phiên bản")
	}
	sess, _ := sessionFrom(ctx)
	row, err := s.q.GetBackupTarget(ctx, pgUUID(req.TargetId))
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.AdminUpdateBackupTarget404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy đích sao lưu")}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get backup destination: %w", err)
	}
	if string(b.Kind) != row.Kind {
		return bad("Không đổi được loại đích — thêm đích mới rồi xóa đích cũ")
	}
	cur, err := backup.TargetFromRow(s.auth.Keyring(), row)
	if err != nil {
		return nil, err
	}
	t := backup.Target{ID: cur.ID, Name: strings.TrimSpace(b.Name), Kind: row.Kind, Settings: settingsFrom(b.Settings), Secret: mergeSecret(cur.Secret, *b)}
	// A new OneDrive token may be another account: look its drive up again.
	if t.Kind == backup.KindOneDrive && b.Token != nil {
		t.Settings.DriveID, t.Settings.DriveType = "", ""
	}
	if msg := prepareTarget(ctx, &t, b.Keep); msg != "" {
		return bad(msg)
	}
	sealed, err := backup.SealTargetSecret(s.auth.Keyring(), req.TargetId, t.Secret)
	if err != nil {
		return nil, err
	}
	settings, _ := json.Marshal(t.Settings)
	var out store.BackupTarget
	err = s.withTx(ctx, func(q store.Querier) error {
		var err error
		out, err = q.UpdateBackupTarget(ctx, store.UpdateBackupTargetParams{ID: row.ID, Name: t.Name, Enabled: b.Enabled, Settings: settings,
			SecretCiphertext: sealed.Ciphertext, SecretWrappedDek: sealed.WrappedDEK, SecretKeyVersion: sealed.KeyVersion, Keep: b.Keep, Version: int32(*b.Version)})
		if err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup_target.update", ObjectType: "backup_target", ObjectID: cur.ID,
			Before: targetSnapshot(row.Name, row.Kind, row.Enabled, cur.Settings, row.Keep),
			After:  targetSnapshot(t.Name, t.Kind, b.Enabled, t.Settings, b.Keep), Meta: infoFrom(ctx).meta})
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return apigen.AdminUpdateBackupTarget409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đích vừa được người khác sửa — tải lại rồi thử lại"}}, nil
	case isUniqueViolation(err):
		return apigen.AdminUpdateBackupTarget409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có đích cùng tên"}}, nil
	case err != nil:
		return nil, fmt.Errorf("update backup destination: %w", err)
	}
	return apigen.AdminUpdateBackupTarget200JSONResponse(toBackupTarget(out)), nil
}

func (s *Server) AdminDeleteBackupTarget(ctx context.Context, req apigen.AdminDeleteBackupTargetRequestObject) (apigen.AdminDeleteBackupTargetResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	row, err := s.q.GetBackupTarget(ctx, pgUUID(req.TargetId))
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.AdminDeleteBackupTarget404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy đích sao lưu")}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get backup destination: %w", err)
	}
	var st backup.TargetSettings
	_ = json.Unmarshal(row.Settings, &st)
	err = s.withTx(ctx, func(q store.Querier) error {
		if _, err := q.DeleteBackupTarget(ctx, row.ID); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup_target.delete", ObjectType: "backup_target",
			ObjectID: req.TargetId.String(), Before: targetSnapshot(row.Name, row.Kind, row.Enabled, st, row.Keep), Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, fmt.Errorf("delete backup destination: %w", err)
	}
	return apigen.AdminDeleteBackupTarget204Response{}, nil
}

func (s *Server) AdminTestBackupTarget(ctx context.Context, req apigen.AdminTestBackupTargetRequestObject) (apigen.AdminTestBackupTargetResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	row, err := s.q.GetBackupTarget(ctx, pgUUID(req.TargetId))
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.AdminTestBackupTarget404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy đích sao lưu")}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get backup destination: %w", err)
	}
	t, err := backup.TargetFromRow(s.auth.Keyring(), row)
	if err != nil {
		return nil, err
	}
	r := backup.Rclone{}
	if s.backups.Svc != nil {
		r = s.backups.Svc.Cfg.Rclone
	}
	refreshed, terr := r.Test(ctx, t)
	if refreshed != "" {
		t.Secret.Token = refreshed
		if sealed, err := backup.SealTargetSecret(s.auth.Keyring(), req.TargetId, t.Secret); err == nil {
			_ = s.q.SaveBackupTargetSecret(ctx, store.SaveBackupTargetSecretParams{ID: row.ID, SecretCiphertext: sealed.Ciphertext,
				SecretWrappedDek: sealed.WrappedDEK, SecretKeyVersion: sealed.KeyVersion})
		}
	}
	out := apigen.BackupTargetTest{Ok: terr == nil, Message: "Kết nối và ghi được"}
	if terr != nil {
		out.Message = terr.Error()
	}
	_ = s.withTx(ctx, func(q store.Querier) error {
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup_target.test", ObjectType: "backup_target",
			ObjectID: req.TargetId.String(), After: map[string]any{"ok": out.Ok}, Meta: infoFrom(ctx).meta})
	})
	return apigen.AdminTestBackupTarget200JSONResponse(out), nil
}

// --- run now / download ---

func (s *Server) AdminRunBackup(ctx context.Context, _ apigen.AdminRunBackupRequestObject) (apigen.AdminRunBackupResponseObject, error) {
	conflict := func(msg string) (apigen.AdminRunBackupResponseObject, error) {
		return apigen.AdminRunBackup409JSONResponse{Message: msg}, nil
	}
	svc := s.backups.Svc
	if svc == nil {
		return conflict("Sao lưu chưa bật (chưa đặt NTB_BACKUP_PASSPHRASE)")
	}
	if runs, err := s.q.ListBackupRuns(ctx, 1); err == nil && len(runs) == 1 && runs[0].Status == "running" && time.Since(runs[0].StartedAt.Time) < 6*time.Hour {
		return conflict("Đang có một bản sao lưu chạy")
	}
	sess, _ := sessionFrom(ctx)
	if err := s.withTx(ctx, func(q store.Querier) error {
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup.run", ObjectType: "backup", ObjectID: "manual", Meta: infoFrom(ctx).meta})
	}); err != nil {
		return nil, err
	}
	// Detached from the request: a backup outlives the click.
	go func() {
		bctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
		defer cancel()
		if res, err := svc.Run(bctx, "manual"); err != nil {
			s.logger.Error("manual backup failed", "error", err)
		} else {
			s.logger.Info("manual backup done", "file", res.File)
		}
	}()
	return apigen.AdminRunBackup202Response{}, nil
}

func (s *Server) AdminDownloadBackup(ctx context.Context, req apigen.AdminDownloadBackupRequestObject) (apigen.AdminDownloadBackupResponseObject, error) {
	notFound := apigen.AdminDownloadBackup404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy bản sao lưu")}
	// A copy of everything: a fresh MFA confirmation, like revealing a password.
	switch code, msg := recentMFA(ctx); code {
	case 403:
		return apigen.AdminDownloadBackup403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Cần bật MFA cho tài khoản trước khi tải bản sao lưu"}}, nil
	case 428:
		return apigen.AdminDownloadBackup428JSONResponse{Message: strings.Replace(msg, "xem mật khẩu", "tải bản sao lưu", 1)}, nil
	}
	f, ok := backup.ParseFileName(req.Name)
	if !ok || s.backups.Dir == "" {
		return notFound, nil
	}
	file, err := os.Open(filepath.Join(s.backups.Dir, f.Name))
	if err != nil {
		return notFound, nil
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return notFound, nil
	}
	sess, _ := sessionFrom(ctx)
	if err := s.withTx(ctx, func(q store.Querier) error {
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "backup.download", ObjectType: "backup", ObjectID: f.Name,
			After: map[string]any{"bytes": info.Size()}, Meta: infoFrom(ctx).meta})
	}); err != nil {
		_ = file.Close()
		return nil, err
	}
	disp, cache := `attachment; filename="`+f.Name+`"`, "no-store"
	return apigen.AdminDownloadBackup200ApplicationoctetStreamResponse{Body: file, ContentLength: info.Size(),
		Headers: apigen.AdminDownloadBackup200ResponseHeaders{ContentDisposition: &disp, CacheControl: &cache}}, nil
}

// backupFiles lists the backups in the directory with what their headers say.
func (s *Server) backupFiles(keyFingerprint string) []apigen.BackupFile {
	out := []apigen.BackupFile{}
	if s.backups.Dir == "" {
		return out
	}
	svc := backup.Service{Cfg: backup.Config{Dir: s.backups.Dir}}
	files, err := svc.Files()
	if err != nil {
		return out
	}
	for _, f := range files {
		path := filepath.Join(s.backups.Dir, f.Name)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		v := apigen.BackupFile{Name: f.Name, Kind: f.Kind, CreatedAt: f.At, SizeBytes: info.Size()}
		if fh, err := os.Open(path); err == nil {
			if m, err := backup.ReadMeta(fh); err == nil {
				v.SameKey, v.SchemaVersion = m.KeyFingerprint == keyFingerprint, int(m.SchemaVersion)
			}
			_ = fh.Close()
		}
		out = append(out, v)
	}
	return out
}
