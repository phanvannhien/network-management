package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Expiry alerts (P2-05, ADR-043): the installation's mail server (system admins), each organization's alert
// settings (owners / admins), the bell, and muting one device.

// sendMail delivers e-mail (a fake in tests).
var sendMail notify.Sender = notify.SendSMTP

var defaultAlertKinds = []string{"warranty", "license", "eos", "contract"}

func smtpView(row store.SmtpSetting) apigen.SmtpSettings {
	return apigen.SmtpSettings{Host: row.Host, Port: int(row.Port), Security: apigen.SmtpSettingsSecurity(row.Security),
		Username: row.Username, PasswordSet: row.PasswordCiphertext != nil, FromAddress: row.FromAddress,
		FromName: row.FromName, PublicUrl: row.PublicUrl, Configured: row.Host != "" && row.FromAddress != ""}
}

// smtpAudit is what the audit log keeps of the settings: never the password, only whether one is set.
type smtpAudit struct {
	Host        string `json:"host"`
	Port        int32  `json:"port"`
	Security    string `json:"security"`
	Username    string `json:"username"`
	PasswordSet bool   `json:"passwordSet"`
	FromAddress string `json:"fromAddress"`
	FromName    string `json:"fromName"`
	PublicURL   string `json:"publicUrl"`
}

func smtpAuditOf(row store.SmtpSetting) smtpAudit {
	return smtpAudit{Host: row.Host, Port: row.Port, Security: row.Security, Username: row.Username,
		PasswordSet: row.PasswordCiphertext != nil, FromAddress: row.FromAddress, FromName: row.FromName, PublicURL: row.PublicUrl}
}

func (s *Server) AdminGetSmtp(ctx context.Context, _ apigen.AdminGetSmtpRequestObject) (apigen.AdminGetSmtpResponseObject, error) {
	row, err := s.q.GetSmtpSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.AdminGetSmtp200JSONResponse(smtpView(store.SmtpSetting{Port: 587, Security: "starttls"})), nil
	}
	if err != nil {
		return nil, fmt.Errorf("get smtp settings: %w", err)
	}
	return apigen.AdminGetSmtp200JSONResponse(smtpView(row)), nil
}

func (s *Server) AdminSaveSmtp(ctx context.Context, req apigen.AdminSaveSmtpRequestObject) (apigen.AdminSaveSmtpResponseObject, error) {
	bad := func(msg string) (apigen.AdminSaveSmtpResponseObject, error) {
		return apigen.AdminSaveSmtp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil {
		return bad("Thiếu dữ liệu")
	}
	host, from, user := strings.TrimSpace(b.Host), strings.TrimSpace(b.FromAddress), strings.TrimSpace(b.Username)
	public := strings.TrimRight(strings.TrimSpace(b.PublicUrl), "/")
	switch {
	case strings.ContainsAny(host, " /\r\n") || len(host) > 253:
		return bad("Máy chủ SMTP không hợp lệ (vd smtp.gmail.com)")
	case b.Port < 1 || b.Port > 65535:
		return bad("Cổng phải từ 1 đến 65535")
	case !slices.Contains([]string{"starttls", "tls", "none"}, string(b.Security)):
		return bad("Kiểu mã hóa không hợp lệ")
	case from != "" && !notify.ValidAddress(from):
		return bad("Địa chỉ gửi không hợp lệ (vd ntb@congty.vn)")
	case host != "" && from == "":
		return bad("Cần địa chỉ gửi")
	case strings.ContainsAny(b.FromName, "\r\n") || strings.ContainsAny(user, "\r\n"):
		return bad("Tên hiển thị / tài khoản không được xuống dòng")
	case user != "" && b.Security == "none":
		return bad("Không gửi mật khẩu qua kết nối không mã hóa: chọn STARTTLS hoặc TLS")
	}
	if public != "" {
		u, err := url.Parse(public)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return bad("Địa chỉ truy cập phải dạng https://ntb.congty.vn")
		}
	}
	sess, _ := sessionFrom(ctx)
	p := store.SaveSmtpSettingsParams{Host: host, Port: int32(b.Port), Security: string(b.Security), Username: user,
		FromAddress: from, FromName: strings.TrimSpace(b.FromName), PublicUrl: public, UpdatedBy: sess.UserID,
		KeepPassword: b.Password == nil}
	if b.Password != nil && *b.Password != "" {
		sealed, err := s.auth.Keyring().Seal([]byte(*b.Password), notify.SMTPPasswordAAD)
		if err != nil {
			return nil, fmt.Errorf("seal smtp password: %w", err)
		}
		p.PasswordCiphertext, p.PasswordWrappedDek = sealed.Ciphertext, sealed.WrappedDEK
		p.PasswordKeyVersion = pgtype.Int2{Int16: sealed.KeyVersion, Valid: true}
	}
	var saved store.SmtpSetting
	err := s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetSmtpSettings(ctx)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("load smtp settings: %w", err)
		}
		if saved, err = q.SaveSmtpSettings(ctx, p); err != nil {
			return fmt.Errorf("save smtp settings: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "smtp.update", ObjectType: "smtp_settings", ObjectID: "1",
			Before: smtpAuditOf(before), After: smtpAuditOf(saved), Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	return apigen.AdminSaveSmtp200JSONResponse(smtpView(saved)), nil
}

func (s *Server) AdminTestSmtp(ctx context.Context, req apigen.AdminTestSmtpRequestObject) (apigen.AdminTestSmtpResponseObject, error) {
	if req.Body == nil || !notify.ValidAddress(strings.TrimSpace(req.Body.To)) {
		return apigen.AdminTestSmtp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Nhập một địa chỉ email để gửi thử"}}, nil
	}
	cfg, _, err := notify.LoadSMTP(ctx, s.q, s.auth.Keyring())
	if err != nil {
		return nil, err
	}
	if !cfg.Configured() {
		return apigen.AdminTestSmtp200JSONResponse{Sent: false, Message: "Chưa cấu hình máy chủ SMTP và địa chỉ gửi"}, nil
	}
	sess, _ := sessionFrom(ctx)
	err = sendMail(ctx, cfg, notify.Message{To: []string{strings.TrimSpace(req.Body.To)},
		Subject: "[NTB] Email thử", Text: "Máy chủ email của Network Topology Builder đã gửi được thư này.\n"})
	if aerr := audit.Write(ctx, s.q, audit.Entry{Actor: sess.UserID, Action: "smtp.test", ObjectType: "smtp_settings", ObjectID: "1",
		After: map[string]any{"to": strings.TrimSpace(req.Body.To), "sent": err == nil}, Meta: infoFrom(ctx).meta}); aerr != nil {
		return nil, aerr
	}
	if err != nil {
		// The server's own words (auth refused, TLS, timeout) help the admin; they never contain the password.
		return apigen.AdminTestSmtp200JSONResponse{Sent: false, Message: err.Error()}, nil
	}
	return apigen.AdminTestSmtp200JSONResponse{Sent: true, Message: "Đã gửi"}, nil
}

// alertRow is the organization's settings, the defaults when it never saved any (version 0).
func (s *Server) alertRow(ctx context.Context, q store.Querier, org pgtype.UUID) (store.AlertSetting, error) {
	row, err := q.GetAlertSettings(ctx, org)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.AlertSetting{OrganizationID: org, Enabled: true, Kinds: defaultAlertKinds,
			Milestones: []int32{90, 60, 30, 7}, EmailAdmins: true, ExtraEmails: []string{}}, nil
	}
	if err != nil {
		return store.AlertSetting{}, fmt.Errorf("get alert settings: %w", err)
	}
	return row, nil
}

func (s *Server) alertView(ctx context.Context, row store.AlertSetting) (apigen.AlertSettings, error) {
	to, err := notify.Recipients(ctx, s.q, store.AlertOrganizationsRow{ID: row.OrganizationID, EmailAdmins: row.EmailAdmins, ExtraEmails: row.ExtraEmails})
	if err != nil {
		return apigen.AlertSettings{}, err
	}
	smtpRow, err := s.q.GetSmtpSettings(ctx)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return apigen.AlertSettings{}, fmt.Errorf("get smtp settings: %w", err)
	}
	kinds := make([]apigen.AlertKind, 0, len(row.Kinds))
	for _, k := range row.Kinds {
		kinds = append(kinds, apigen.AlertKind(k))
	}
	ms := make([]int, 0, len(row.Milestones))
	for _, m := range row.Milestones {
		ms = append(ms, int(m))
	}
	if to == nil {
		to = []string{}
	}
	extra := row.ExtraEmails
	if extra == nil {
		extra = []string{}
	}
	return apigen.AlertSettings{Enabled: row.Enabled, Kinds: kinds, Milestones: ms, EmailAdmins: row.EmailAdmins,
		ExtraEmails: extra, Version: int(row.Version), Recipients: to,
		SmtpConfigured: smtpRow.Host != "" && smtpRow.FromAddress != ""}, nil
}

func (s *Server) GetAlertSettings(ctx context.Context, req apigen.GetAlertSettingsRequestObject) (apigen.GetAlertSettingsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.GetAlertSettings403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgAlertAdmin}}, nil
	}
	row, err := s.alertRow(ctx, s.q, m.OrgID)
	if err != nil {
		return nil, err
	}
	v, err := s.alertView(ctx, row)
	if err != nil {
		return nil, err
	}
	return apigen.GetAlertSettings200JSONResponse(v), nil
}

const msgAlertAdmin = "Chỉ chủ sở hữu hoặc quản trị tổ chức được chỉnh cảnh báo"

func (s *Server) SaveAlertSettings(ctx context.Context, req apigen.SaveAlertSettingsRequestObject) (apigen.SaveAlertSettingsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.SaveAlertSettings403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgAlertAdmin}}, nil
	}
	bad := func(msg string) (apigen.SaveAlertSettingsResponseObject, error) {
		return apigen.SaveAlertSettings400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil {
		return bad("Thiếu dữ liệu")
	}
	kinds := []string{}
	for _, k := range b.Kinds {
		if !k.Valid() {
			return bad("Loại cảnh báo không hợp lệ")
		}
		if !slices.Contains(kinds, string(k)) {
			kinds = append(kinds, string(k))
		}
	}
	if len(b.Milestones) < 1 || len(b.Milestones) > 6 {
		return bad("Chọn từ 1 đến 6 mốc báo trước")
	}
	ms := []int32{}
	for _, d := range b.Milestones {
		if d < 1 || d > 365 {
			return bad("Mốc báo trước phải từ 1 đến 365 ngày")
		}
		if !slices.Contains(ms, int32(d)) {
			ms = append(ms, int32(d))
		}
	}
	slices.SortFunc(ms, func(a, b int32) int { return int(b - a) })
	extra := []string{}
	if len(b.ExtraEmails) > 20 {
		return bad("Tối đa 20 địa chỉ thêm")
	}
	for _, e := range b.ExtraEmails {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if !notify.ValidAddress(e) {
			return bad(fmt.Sprintf("Địa chỉ email không hợp lệ: %s", e))
		}
		if !slices.ContainsFunc(extra, func(x string) bool { return strings.EqualFold(x, e) }) {
			extra = append(extra, e)
		}
	}
	var saved store.AlertSetting
	conflict := false
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := s.alertRow(ctx, q, m.OrgID)
		if err != nil {
			return err
		}
		if b.Version == 0 {
			saved, err = q.InsertAlertSettings(ctx, store.InsertAlertSettingsParams{OrganizationID: m.OrgID, Enabled: b.Enabled,
				Kinds: kinds, Milestones: ms, EmailAdmins: b.EmailAdmins, ExtraEmails: extra})
		} else {
			saved, err = q.UpdateAlertSettingsVersioned(ctx, store.UpdateAlertSettingsVersionedParams{OrganizationID: m.OrgID,
				Enabled: b.Enabled, Kinds: kinds, Milestones: ms, EmailAdmins: b.EmailAdmins, ExtraEmails: extra, Version: int32(b.Version)})
		}
		if errors.Is(err, pgx.ErrNoRows) {
			conflict = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save alert settings: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "alerts.update",
			ObjectType: "alert_settings", ObjectID: uuidStr(m.OrgID), Before: alertAuditOf(before), After: alertAuditOf(saved),
			Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if conflict {
		return apigen.SaveAlertSettings409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Cài đặt vừa được người khác lưu — tải lại rồi sửa tiếp"}}, nil
	}
	v, err := s.alertView(ctx, saved)
	if err != nil {
		return nil, err
	}
	return apigen.SaveAlertSettings200JSONResponse(v), nil
}

func alertAuditOf(r store.AlertSetting) map[string]any {
	return map[string]any{"enabled": r.Enabled, "kinds": r.Kinds, "milestones": r.Milestones, "emailAdmins": r.EmailAdmins, "extraEmails": r.ExtraEmails}
}

func (s *Server) ListNotifications(ctx context.Context, req apigen.ListNotificationsRequestObject) (apigen.ListNotificationsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListNotifications(ctx, store.ListNotificationsParams{OrganizationID: m.OrgID, Lim: 50})
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	seen, err := s.q.GetNotificationsSeen(ctx, store.GetNotificationsSeenParams{OrganizationID: m.OrgID, UserID: m.UserID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("notifications seen: %w", err)
	}
	out := apigen.ListNotifications200JSONResponse{Notifications: []apigen.Notification{}}
	for _, r := range rows {
		unread := !seen.Valid || r.CreatedAt.Time.After(seen.Time)
		if unread {
			out.Unread++
		}
		out.Notifications = append(out.Notifications, apigen.Notification{Id: uuid.UUID(r.ID.Bytes), Kind: apigen.AlertKind(r.Kind),
			DeviceId: optUUID(r.DeviceID), ContractId: optUUID(r.ContractID), Hostname: r.Title, SiteCode: r.Place,
			DueDate: *apiDate(r.DueDate), Milestone: int(r.Milestone), CreatedAt: r.CreatedAt.Time, Unread: unread})
	}
	return out, nil
}

func (s *Server) MarkNotificationsSeen(ctx context.Context, req apigen.MarkNotificationsSeenRequestObject) (apigen.MarkNotificationsSeenResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if err := s.q.MarkNotificationsSeen(ctx, store.MarkNotificationsSeenParams{OrganizationID: m.OrgID, UserID: m.UserID}); err != nil {
		return nil, fmt.Errorf("mark notifications seen: %w", err)
	}
	return apigen.MarkNotificationsSeen204Response{}, nil
}

func (s *Server) SetDeviceAlertsMuted(ctx context.Context, req apigen.SetDeviceAlertsMutedRequestObject) (apigen.SetDeviceAlertsMutedResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.SetDeviceAlertsMuted400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		d, ok, err := loadDevice(ctx, q, m, req.DeviceId)
		if err != nil {
			return err
		}
		if !ok {
			code = 404
			return errRollback
		}
		if level, err := deviceLevel(ctx, q, m, d); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			code = 403
			return errRollback
		}
		if d.AlertsMuted == req.Body.Muted {
			return nil
		}
		if _, err := q.SetDeviceAlertsMuted(ctx, store.SetDeviceAlertsMutedParams{OrganizationID: m.OrgID, ID: d.ID, Muted: req.Body.Muted}); err != nil {
			return fmt.Errorf("mute device alerts: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.alerts_mute",
			ObjectType: "device", ObjectID: uuidStr(d.ID), Before: map[string]bool{"alertsMuted": d.AlertsMuted},
			After: map[string]bool{"alertsMuted": req.Body.Muted}, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.SetDeviceAlertsMuted404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case 403:
		return apigen.SetDeviceAlertsMuted403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	return apigen.SetDeviceAlertsMuted204Response{}, nil
}
