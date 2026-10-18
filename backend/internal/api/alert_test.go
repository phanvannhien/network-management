package api

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

// fakeMail records what would have been sent.
type fakeMail struct {
	mu   sync.Mutex
	sent []notify.Message
	cfgs []notify.SMTPConfig
}

func (f *fakeMail) send(_ context.Context, cfg notify.SMTPConfig, msg notify.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, msg)
	f.cfgs = append(f.cfgs, cfg)
	return nil
}

func useFakeMail(t *testing.T) *fakeMail {
	t.Helper()
	f := &fakeMail{}
	old := sendMail
	sendMail = f.send
	t.Cleanup(func() { sendMail = old })
	return f
}

const smtpSecret = "S3cret-smtp-pass!"

func saveSmtp(t *testing.T, c *tenanttest.Client, body map[string]any) (int, map[string]any) {
	t.Helper()
	base := map[string]any{"host": "smtp.example.com", "port": 587, "security": "starttls", "username": "ntb@example.com",
		"fromAddress": "ntb@example.com", "fromName": "NTB", "publicUrl": "https://ntb.example.com"}
	for k, v := range body {
		base[k] = v
	}
	return c.Do("PUT", "/api/admin/smtp", base)
}

// P2-05: only system admins set the mail server; the password is sealed, never returned, never audited.
func TestSmtpSettings(t *testing.T) {
	mail := useFakeMail(t)
	fx := newOrgFixture(t)
	admin := fx.NewUser(t, "sysadmin-smtp@example.com", true)

	if status, _ := saveSmtp(t, fx.A, map[string]any{"password": smtpSecret}); status != http.StatusForbidden {
		t.Errorf("org owner saving smtp: %d", status)
	}
	if status, got := admin.Do("GET", "/api/admin/smtp", nil); status != http.StatusOK || got["configured"] != false || got["port"] != float64(587) {
		t.Fatalf("defaults: %d %v", status, got)
	}
	status, got := saveSmtp(t, admin, map[string]any{"password": smtpSecret})
	if status != http.StatusOK || got["passwordSet"] != true || got["configured"] != true {
		t.Fatalf("save: %d %v", status, got)
	}
	var raw []byte
	if err := fx.Pool.QueryRow(context.Background(), `SELECT password_ciphertext FROM smtp_settings`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(smtpSecret)) {
		t.Error("password stored in clear")
	}
	var logged string
	if err := fx.Pool.QueryRow(context.Background(), `SELECT string_agg(before::text || after::text, ' ') FROM audit_log WHERE action = 'smtp.update'`).Scan(&logged); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(logged, smtpSecret) || !strings.Contains(logged, "passwordSet") {
		t.Errorf("audit: %s", logged)
	}

	// Omitted = kept (the test mail authenticates with it), empty = removed.
	if status, got = saveSmtp(t, admin, map[string]any{"fromName": "NTB 2"}); got["passwordSet"] != true {
		t.Errorf("password not kept: %d %v", status, got)
	}
	if status, got := admin.Do("POST", "/api/admin/smtp/test", map[string]any{"to": "me@example.com"}); status != http.StatusOK || got["sent"] != true {
		t.Fatalf("test mail: %d %v", status, got)
	}
	if len(mail.cfgs) != 1 || mail.cfgs[0].Password != smtpSecret || mail.sent[0].To[0] != "me@example.com" {
		t.Errorf("test mail sent with %+v", mail.cfgs)
	}
	if _, got = saveSmtp(t, admin, map[string]any{"password": ""}); got["passwordSet"] != false {
		t.Errorf("password not removed: %v", got)
	}
	for _, bad := range []map[string]any{
		{"fromAddress": "not mail"}, {"port": 0}, {"security": "none"}, {"publicUrl": "ftp://x"}, {"host": "a b"},
	} {
		if status, _ := saveSmtp(t, admin, bad); status != http.StatusBadRequest {
			t.Errorf("%v: %d", bad, status)
		}
	}
	if status, _ := admin.Do("POST", "/api/admin/smtp/test", map[string]any{"to": "x\r\nBcc: y@z.com"}); status != http.StatusBadRequest {
		t.Errorf("bad test address: %d", status)
	}
}

func orgOwnerEmail(t *testing.T, fx *tenanttest.Fixture, org uuid.UUID) string {
	t.Helper()
	var email string
	if err := fx.Pool.QueryRow(context.Background(),
		`SELECT u.email::text FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.role = 'owner' LIMIT 1`, org).Scan(&email); err != nil {
		t.Fatal(err)
	}
	return email
}

// P2-05: an organization's alert settings — owners / admins only, optimistic lock, tenant-scoped.
func TestAlertSettings(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	path := func(o uuid.UUID) string { return orgPath(o) + "/alert-settings" }
	fx.AssertCrossTenantDenied(t, "GET", path, nil)
	fx.AssertCrossTenantDenied(t, "PUT", path, map[string]any{"enabled": true, "kinds": []string{"warranty"}, "milestones": []int{30},
		"emailAdmins": true, "extraEmails": []string{}, "version": 0})

	status, got := fx.A.Do("GET", path(org), nil)
	owner := orgOwnerEmail(t, fx, org)
	if status != http.StatusOK || got["version"] != float64(0) || got["enabled"] != true || len(got["milestones"].([]any)) != 4 ||
		len(got["recipients"].([]any)) != 1 || got["recipients"].([]any)[0] != owner {
		t.Fatalf("defaults: %d %v", status, got)
	}
	editor := fx.NewUser(t, "editor-alerts@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	if status, _ := editor.Do("GET", path(org), nil); status != http.StatusForbidden {
		t.Errorf("editor reading: %d", status)
	}
	body := map[string]any{"enabled": true, "kinds": []string{"license", "eos"}, "milestones": []int{7, 30, 30},
		"emailAdmins": false, "extraEmails": []string{"noc@example.com", "NOC@example.com"}, "version": 0}
	status, got = fx.A.Do("PUT", path(org), body)
	if status != http.StatusOK || got["version"] != float64(1) || len(got["milestones"].([]any)) != 2 ||
		len(got["recipients"].([]any)) != 1 || got["recipients"].([]any)[0] != "noc@example.com" {
		t.Fatalf("save: %d %v", status, got)
	}
	if status, _ := fx.A.Do("PUT", path(org), body); status != http.StatusConflict {
		t.Errorf("stale version: %d", status)
	}
	if status, _ := editor.Do("PUT", path(org), body); status != http.StatusForbidden {
		t.Errorf("editor saving: %d", status)
	}
	body["version"], body["extraEmails"] = 1, []string{"bad address"}
	if status, _ := fx.A.Do("PUT", path(org), body); status != http.StatusBadRequest {
		t.Errorf("bad email: %d", status)
	}
	if auditCount(t, fx.Pool, "alerts.update", org) != 1 {
		t.Error("alerts.update not audited")
	}
}

// P2-05: the hourly run raises each milestone once and e-mails one digest a day; muted, retired and far dates stay
// quiet; the bell lists them per member.
func TestAlertRun(t *testing.T) {
	mail := useFakeMail(t)
	fx := newOrgFixture(t)
	org := fx.OrgA
	admin := fx.NewUser(t, "sysadmin-run@example.com", true)
	if status, got := saveSmtp(t, admin, map[string]any{"password": smtpSecret}); status != http.StatusOK {
		t.Fatalf("smtp: %d %v", status, got)
	}
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	day := func(d int) string { return today.AddDate(0, 0, d).Format("2006-01-02") }
	dev := func(host string, extra map[string]any) string {
		body := map[string]any{"hostname": host, "type": "firewall", "siteId": site, "model": "No Such 9000", "lifecycle": "active"}
		for k, v := range extra {
			body[k] = v
		}
		return idOf(t, mustCreate(t, fx.A, devicesPath(org), body))
	}
	fw := dev("FW1", map[string]any{"warrantyEnd": day(20), "licenseEnd": day(-2), "eosDate": day(200)})
	muted := dev("FW2", map[string]any{"warrantyEnd": day(5)})
	dev("FW3", map[string]any{"warrantyEnd": day(5), "lifecycle": "retired"})
	dev("OLD", map[string]any{"eosDate": day(-400)}) // passed long ago: on the dashboard, not announced
	if status, _ := fx.A.Do("PUT", devicePath(org, muted)+"/alerts-muted", map[string]any{"muted": true}); status != http.StatusNoContent {
		t.Fatalf("mute: %d", status)
	}
	// Another organization can neither reach it through its own path nor through ours.
	for _, p := range []string{devicePath(fx.OrgB, muted), devicePath(org, muted)} {
		if status, _ := fx.B.Do("PUT", p+"/alerts-muted", map[string]any{"muted": false}); status != http.StatusNotFound {
			t.Errorf("org B muting %s: %d", p, status)
		}
	}

	r := notify.Runner{Pool: fx.Pool, Keys: testKeyring(t), Send: sendMail, Logger: slog.New(slog.DiscardHandler)}
	at := func(hour int) time.Time {
		return time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, time.Local)
	}
	ctx := context.Background()

	// Before 7: raised, not e-mailed.
	if err := r.RunOnce(ctx, at(6)); err != nil {
		t.Fatal(err)
	}
	if len(mail.sent) != 0 {
		t.Fatalf("mailed before the digest hour: %v", mail.sent)
	}
	var n int
	_ = fx.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE organization_id = $1`, org).Scan(&n)
	if n != 2 { // FW1 warranty (30) and license (passed); not eos (200 days), not the muted / retired ones
		t.Fatalf("notifications: %d", n)
	}
	// The bell: two unread, then read.
	status, bell := fx.A.Do("GET", orgPath(org)+"/notifications", nil)
	if status != http.StatusOK || bell["unread"] != float64(2) || len(bell["notifications"].([]any)) != 2 {
		t.Fatalf("bell: %d %v", status, bell)
	}
	fx.AssertCrossTenantDenied(t, "GET", func(o uuid.UUID) string { return orgPath(o) + "/notifications" }, nil)
	if status, _ := fx.A.Do("POST", orgPath(org)+"/notifications/seen", nil); status != http.StatusNoContent {
		t.Fatalf("seen: %d", status)
	}
	if _, bell = fx.A.Do("GET", orgPath(org)+"/notifications", nil); bell["unread"] != float64(0) {
		t.Errorf("still unread: %v", bell["unread"])
	}

	// From 7: one digest to the owner, with both lines and a link.
	if err := r.RunOnce(ctx, at(8)); err != nil {
		t.Fatal(err)
	}
	if len(mail.sent) != 1 {
		t.Fatalf("digests: %d", len(mail.sent))
	}
	m := mail.sent[0]
	if len(m.To) != 1 || m.To[0] != orgOwnerEmail(t, fx, org) || !strings.Contains(m.Text, "FW1") ||
		!strings.Contains(m.Text, "Hết bảo hành") || !strings.Contains(m.Text, "Hết license") ||
		!strings.Contains(m.Text, "https://ntb.example.com/o/"+org.String()+"/devices/"+fw) || strings.Contains(m.Text, "FW2") {
		t.Errorf("digest: %+v", m)
	}
	// Same day again, and a renewed warranty: nothing more today.
	_, d := fx.A.Do("GET", devicePath(org, fw), nil)
	d["warrantyEnd"] = day(25)
	if status, got := fx.A.Do("PATCH", devicePath(org, fw), d); status != http.StatusOK {
		t.Fatalf("renew: %d %v", status, got)
	}
	if err := r.RunOnce(ctx, at(9)); err != nil {
		t.Fatal(err)
	}
	if len(mail.sent) != 1 {
		t.Errorf("second digest the same day: %d", len(mail.sent))
	}
	_ = fx.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE organization_id = $1`, org).Scan(&n)
	if n != 3 { // the renewed date is a new date (30-day milestone again)
		t.Errorf("after renewal: %d notifications", n)
	}
	// Alerts off: nothing raised.
	_, cur := fx.A.Do("GET", orgPath(org)+"/alert-settings", nil)
	if status, got := fx.A.Do("PUT", orgPath(org)+"/alert-settings", map[string]any{"enabled": false, "kinds": []string{"warranty"},
		"milestones": []int{30}, "emailAdmins": true, "extraEmails": []string{}, "version": cur["version"]}); status != http.StatusOK {
		t.Fatalf("turn off: %d %v", status, got)
	}
	dev("FW4", map[string]any{"warrantyEnd": day(3)})
	if err := r.RunOnce(ctx, at(10)); err != nil {
		t.Fatal(err)
	}
	_ = fx.Pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE organization_id = $1`, org).Scan(&n)
	if n != 3 {
		t.Errorf("alerts off still raised: %d", n)
	}
	if auditCount(t, fx.Pool, "device.alerts_mute", org) != 1 {
		t.Error("mute not audited")
	}
}
