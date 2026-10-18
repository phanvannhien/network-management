package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/rotate"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func credsPath(org uuid.UUID) string { return orgPath(org) + "/credentials" }
func cloudPath(org uuid.UUID) string { return orgPath(org) + "/cloud-accounts" }

const devicePassword = "  Adm1n!pass with spaces  "

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func grant(t *testing.T, fx *tenanttest.Fixture, org, user uuid.UUID, perms ...string) {
	t.Helper()
	if _, err := fx.Pool.Exec(context.Background(), `UPDATE memberships SET permissions = $3 WHERE organization_id = $1 AND user_id = $2`,
		org, user, perms); err != nil {
		t.Fatal(err)
	}
}

// P2-02: credentials — managers write, members read names and devices, never a secret; sealed at rest; audited without it.
func TestCredentials(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	sw1 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW1", "type": "l2_switch", "siteId": site}))
	sw2 := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW2", "type": "l2_switch", "siteId": site}))
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "HN"}))
	devB := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B1", "type": "router", "siteId": siteB}))
	fx.AssertCrossTenantDenied(t, "GET", credsPath, nil)

	body := map[string]any{"name": "Switch admin", "kind": "ssh", "username": "admin", "secret": devicePassword, "rotateDays": 90,
		"devices": []map[string]any{{"deviceId": sw1, "purpose": "ssh"}, {"deviceId": sw2, "purpose": "web"}}}
	status, cr := fx.A.Do("POST", credsPath(org), body)
	c := cr["credential"].(map[string]any)
	if status != http.StatusCreated || c["hasSecret"] != true || len(cr["devices"].([]any)) != 2 || c["lastRotatedOn"] != calendarToday().Format("2006-01-02") {
		t.Fatalf("create: %d %v", status, cr)
	}
	cid := c["id"].(string)
	var ct []byte
	_ = fx.Pool.QueryRow(context.Background(), `SELECT secret_ciphertext FROM credentials WHERE id = $1`, cid).Scan(&ct)
	if len(ct) == 0 || bytes.Contains(ct, []byte("Adm1n")) {
		t.Error("secret not sealed")
	}
	// Nowhere in lists, details or the audit log.
	_, list := fx.A.Do("GET", credsPath(org)+"?deviceId="+sw1, nil)
	_, detail := fx.A.Do("GET", credsPath(org)+"/"+cid, nil)
	var logged string
	_ = fx.Pool.QueryRow(context.Background(), `SELECT coalesce(string_agg(coalesce(before::text,'') || coalesce(after::text,''), ' '), '') FROM audit_log WHERE organization_id = $1`, org).Scan(&logged)
	for where, text := range map[string]string{"list": toJSON(list), "detail": toJSON(detail), "audit": logged} {
		if strings.Contains(text, "Adm1n") {
			t.Errorf("secret visible in %s", where)
		}
	}
	if len(list["credentials"].([]any)) != 1 {
		t.Errorf("by device: %v", list)
	}

	editor := fx.NewUser(t, "editor-vault@example.com", false, tenanttest.Member{Org: org, Role: "editor"})
	if status, _ := editor.Do("POST", credsPath(org), body); status != http.StatusForbidden {
		t.Errorf("editor without credential.manage: %d", status)
	}
	if status, l := editor.Do("GET", credsPath(org), nil); status != http.StatusOK || len(l["credentials"].([]any)) != 1 {
		t.Errorf("editor reading: %d", status)
	}
	grant(t, fx, org, editor.UserID, "credential.manage")
	if status, _ := editor.Do("POST", credsPath(org), map[string]any{"name": "Camera", "kind": "web", "devices": []any{}}); status != http.StatusCreated {
		t.Errorf("editor with credential.manage: %d", status)
	}

	// Edit: secret omitted = kept; other org's device refused; new secret = rotated today; empty = removed.
	edit := map[string]any{"name": "Switch admin", "kind": "ssh", "username": "netadmin", "rotateDays": 90, "lastRotatedOn": "2026-01-01",
		"devices": []map[string]any{{"deviceId": sw1}}, "version": 1}
	if status, got := fx.A.Do("PATCH", credsPath(org)+"/"+cid, edit); status != http.StatusOK || got["credential"].(map[string]any)["hasSecret"] != true ||
		got["credential"].(map[string]any)["rotateDue"] != "2026-04-01" {
		t.Fatalf("edit keeping secret: %d %v", status, got)
	}
	edit["version"], edit["devices"] = 2, []map[string]any{{"deviceId": devB}}
	if status, _ := fx.A.Do("PATCH", credsPath(org)+"/"+cid, edit); status != http.StatusBadRequest {
		t.Errorf("other org's device: %d", status)
	}
	edit["devices"] = []map[string]any{{"deviceId": sw1}}
	edit["secret"] = "N3w-pass"
	delete(edit, "lastRotatedOn")
	if status, got := fx.A.Do("PATCH", credsPath(org)+"/"+cid, edit); status != http.StatusOK ||
		got["credential"].(map[string]any)["lastRotatedOn"] != calendarToday().Format("2006-01-02") {
		t.Fatalf("rotate: %d %v", status, got)
	}
	if status, _ := fx.A.Do("PATCH", credsPath(org)+"/"+cid, edit); status != http.StatusConflict {
		t.Errorf("stale: %d", status)
	}
	looks := auditCount(t, fx.Pool, "credential.reveal", org)
	for _, p := range []string{credsPath(fx.OrgB) + "/" + cid, credsPath(org) + "/" + cid} {
		for _, c := range []struct {
			method, path string
			body         any
		}{{"GET", p, nil}, {"POST", p + "/reveal", map[string]any{"action": "reveal"}}, {"PATCH", p, edit}, {"DELETE", p, nil}} {
			if status, _ := fx.B.Do(c.method, c.path, c.body); status != http.StatusNotFound {
				t.Errorf("org B %s %s: %d", c.method, c.path, status)
			}
		}
	}
	if auditCount(t, fx.Pool, "credential.reveal", org) != looks || auditCount(t, fx.Pool, "credential.reveal", fx.OrgB) != 0 {
		t.Error("a refused look was audited as a look")
	}
	if status, _ := fx.A.Do("DELETE", credsPath(org)+"/"+cid, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	_ = fx.Pool.QueryRow(context.Background(), `SELECT secret_ciphertext FROM credentials WHERE id = $1`, cid).Scan(&ct)
	if ct != nil {
		t.Error("a deleted credential keeps its secret")
	}
	for _, a := range []string{"credential.create", "credential.update", "credential.delete"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("%s not audited", a)
		}
	}
}

// P2-02: showing / copying a secret needs the reveal right and an MFA code within five minutes; each look is audited;
// a ciphertext moved onto another row does not open.
func TestRevealCredential(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	_, cr := fx.A.Do("POST", credsPath(org), map[string]any{"name": "Core enable", "kind": "enable", "secret": devicePassword, "devices": []any{}})
	cid := cr["credential"].(map[string]any)["id"].(string)
	reveal := func(c *tenanttest.Client, action string) (int, map[string]any) {
		return c.Do("POST", credsPath(org)+"/"+cid+"/reveal", map[string]any{"action": action})
	}
	if status, got := reveal(fx.A, "reveal"); status != http.StatusOK || got["secret"] != devicePassword || got["clearAfterSeconds"] != float64(30) {
		t.Fatalf("owner reveal: %d %v", status, got)
	}
	req := httptestReveal(t, fx, org, cid)
	if req.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("reveal cache: %q", req.Header.Get("Cache-Control"))
	}
	if status, _ := reveal(fx.A, "copy"); status != http.StatusOK {
		t.Fatal("copy")
	}
	if auditCount(t, fx.Pool, "credential.reveal", org) != 2 || auditCount(t, fx.Pool, "credential.copy", org) != 1 { // two looks: the check above and the header check
		t.Error("looks not audited")
	}
	viewer := fx.NewUser(t, "viewer-reveal@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := reveal(viewer, "reveal"); status != http.StatusForbidden {
		t.Errorf("viewer without the right: %d", status)
	}
	grant(t, fx, org, viewer.UserID, "credential.reveal")
	if status, _ := reveal(viewer, "reveal"); status != http.StatusOK {
		t.Errorf("viewer with credential.reveal: %d", status)
	}
	// MFA older than five minutes: confirm again.
	if _, err := fx.Pool.Exec(context.Background(), `UPDATE sessions SET mfa_verified_at = now() - interval '6 minutes' WHERE user_id = $1`, viewer.UserID); err != nil {
		t.Fatal(err)
	}
	if status, got := reveal(viewer, "reveal"); status != http.StatusPreconditionRequired || !strings.Contains(got["message"].(string), "MFA") {
		t.Errorf("stale MFA: %d %v", status, got)
	}
	// No MFA on the account at all: nothing to confirm, set it up first (403, not the MFA prompt).
	if _, err := fx.Pool.Exec(context.Background(), `DELETE FROM mfa_totp WHERE user_id = $1`, viewer.UserID); err != nil {
		t.Fatal(err)
	}
	if status, _ := reveal(viewer, "reveal"); status != http.StatusForbidden {
		t.Errorf("no MFA at all: %d", status)
	}
	// Another row's ciphertext does not open here.
	_, other := fx.A.Do("POST", credsPath(org), map[string]any{"name": "Other", "kind": "ssh", "secret": "x", "devices": []any{}})
	oid := other["credential"].(map[string]any)["id"].(string)
	if _, err := fx.Pool.Exec(context.Background(), `UPDATE credentials SET (secret_ciphertext, secret_wrapped_dek) =
		(SELECT secret_ciphertext, secret_wrapped_dek FROM credentials WHERE id = $1) WHERE id = $2`, cid, oid); err != nil {
		t.Fatal(err)
	}
	if status, got := fx.A.Do("POST", credsPath(org)+"/"+oid+"/reveal", map[string]any{"action": "reveal"}); status == http.StatusOK {
		t.Errorf("moved ciphertext opened: %v", got)
	}
}

// P2-03: cloud accounts — vendor and devices of the organization, MFA holder, sealed password, erased on delete.
func TestCloudAccounts(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW1", "type": "firewall", "siteId": site}))
	vid := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "manufacturer", "name": "Fortinet"}))
	vB := idOf(t, mustCreate(t, fx.B, vendorsPath(fx.OrgB), map[string]any{"kind": "manufacturer", "name": "Fortinet"}))
	fx.AssertCrossTenantDenied(t, "GET", cloudPath, nil)
	body := map[string]any{"provider": "forticloud", "name": "FortiCloud chính", "portalUrl": "https://support.fortinet.com",
		"username": "it@congty.vn", "secret": "Cl0ud!", "mfaHolder": "Anh Minh (iPhone)", "expiresOn": "2027-06-30",
		"vendorId": vid, "deviceIds": []string{fw}}
	status, got := fx.A.Do("POST", cloudPath(org), body)
	a := got["account"].(map[string]any)
	if status != http.StatusCreated || a["hasSecret"] != true || a["vendorName"] != "Fortinet" || len(got["devices"].([]any)) != 1 {
		t.Fatalf("create: %d %v", status, got)
	}
	aid := a["id"].(string)
	if status, r := fx.A.Do("POST", cloudPath(org)+"/"+aid+"/reveal", map[string]any{"action": "copy"}); status != http.StatusOK || r["secret"] != "Cl0ud!" {
		t.Errorf("reveal: %d %v", status, r)
	}
	if auditCount(t, fx.Pool, "cloud_account.copy", org) != 1 {
		t.Error("copy not audited")
	}
	for name, bad := range map[string]map[string]any{
		"other org's vendor": {"provider": "meraki", "name": "x", "vendorId": vB, "deviceIds": []string{}},
		"unsafe portal":      {"provider": "meraki", "name": "y", "portalUrl": "javascript:alert(1)", "deviceIds": []string{}},
	} {
		if status, _ := fx.A.Do("POST", cloudPath(org), bad); status != http.StatusBadRequest {
			t.Errorf("%s: %d", name, status)
		}
	}
	if _, l := fx.A.Do("GET", cloudPath(org)+"?deviceId="+fw, nil); len(l["accounts"].([]any)) != 1 || strings.Contains(toJSON(l), "Cl0ud") {
		t.Errorf("by device: %v", l)
	}
	for _, p := range []string{cloudPath(fx.OrgB) + "/" + aid, cloudPath(org) + "/" + aid} {
		for _, c := range []struct {
			method, path string
			body         any
		}{{"GET", p, nil}, {"POST", p + "/reveal", map[string]any{"action": "reveal"}}, {"PATCH", p, map[string]any{"provider": "meraki", "name": "x", "deviceIds": []string{}, "version": 1}}, {"DELETE", p, nil}} {
			if status, _ := fx.B.Do(c.method, c.path, c.body); status != http.StatusNotFound {
				t.Errorf("org B %s %s: %d", c.method, c.path, status)
			}
		}
	}
	if auditCount(t, fx.Pool, "cloud_account.reveal", fx.OrgB) != 0 || auditCount(t, fx.Pool, "cloud_account.reveal", org) != 0 {
		t.Error("a refused look was audited")
	}
	if status, _ := fx.A.Do("DELETE", cloudPath(org)+"/"+aid, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	var ct []byte
	_ = fx.Pool.QueryRow(context.Background(), `SELECT secret_ciphertext FROM cloud_accounts WHERE id = $1`, aid).Scan(&ct)
	if ct != nil {
		t.Error("a deleted account keeps its password")
	}
}

// P2-02: master key rotation moves every secret to the new key in one go; a secret that does not open aborts it all.
func TestRotateMasterKey(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	ctx := context.Background()
	_, cr := fx.A.Do("POST", credsPath(org), map[string]any{"name": "R", "kind": "ssh", "secret": "rot-1", "devices": []any{}})
	cid := cr["credential"].(map[string]any)["id"].(string)
	_, ca := fx.A.Do("POST", cloudPath(org), map[string]any{"provider": "unifi", "name": "UniFi", "secret": "rot-2", "deviceIds": []any{}})
	aid := ca["account"].(map[string]any)["id"].(string)
	// A backup destination's secrets move too (P2-13).
	_, bt := fx.NewUser(t, "sysadmin-rotate@example.com", true).Do("POST", "/api/admin/backup-targets", map[string]any{
		"name": "S3", "kind": "s3", "enabled": true, "keep": "7,4,12", "secretKey": "rot-3",
		"settings": map[string]any{"provider": "AWS", "bucket": "b", "accessKeyId": "AK"}})
	bid, _ := bt["id"].(string)
	old := testKeyring(t)
	// The fixture's MFA rows are placeholders; one real seed stands for them.
	if _, err := fx.Pool.Exec(ctx, `DELETE FROM mfa_totp`); err != nil {
		t.Fatal(err)
	}
	seed, _ := old.Seal([]byte("JBSWY3DPEHPK3PXP"), secrets.TOTPAAD(fx.A.UserID.String()))
	if _, err := fx.Pool.Exec(ctx, `INSERT INTO mfa_totp (user_id, secret_ciphertext, wrapped_dek, key_version, enabled_at) VALUES ($1, $2, $3, $4, now())`,
		fx.A.UserID, seed.Ciphertext, seed.WrappedDEK, seed.KeyVersion); err != nil {
		t.Fatal(err)
	}
	next, _ := secrets.NewKeyringVersion(bytes.Repeat([]byte{9}, secrets.KeySize), 2)
	wrong, _ := secrets.NewKeyringVersion(bytes.Repeat([]byte{5}, secrets.KeySize), 1)
	if _, err := rotate.Run(ctx, fx.Pool, wrong, next); err == nil {
		t.Fatal("rotation with the wrong old key went through")
	}
	n, err := rotate.Run(ctx, fx.Pool, old, next)
	if err != nil || n.Credentials != 1 || n.CloudAccounts != 1 || n.TOTP != 1 || n.BackupTargets != 1 {
		t.Fatalf("rotate: %+v %v", n, err)
	}
	var ct, dek []byte
	var ver int16
	_ = fx.Pool.QueryRow(ctx, `SELECT secret_ciphertext, secret_wrapped_dek, secret_key_version FROM credentials WHERE id = $1`, cid).Scan(&ct, &dek, &ver)
	if pt, err := next.Open(secrets.Sealed{Ciphertext: ct, WrappedDEK: dek, KeyVersion: ver}, secrets.CredentialAAD(cid)); err != nil || string(pt) != "rot-1" {
		t.Errorf("credential after rotation: %q %v", pt, err)
	}
	_ = fx.Pool.QueryRow(ctx, `SELECT secret_ciphertext, secret_wrapped_dek, secret_key_version FROM cloud_accounts WHERE id = $1`, aid).Scan(&ct, &dek, &ver)
	if pt, err := next.Open(secrets.Sealed{Ciphertext: ct, WrappedDEK: dek, KeyVersion: ver}, secrets.CloudAccountAAD(aid)); err != nil || string(pt) != "rot-2" {
		t.Errorf("cloud account after rotation: %q %v", pt, err)
	}
	_ = fx.Pool.QueryRow(ctx, `SELECT secret_ciphertext, secret_wrapped_dek, secret_key_version FROM backup_targets WHERE id = $1`, bid).Scan(&ct, &dek, &ver)
	if pt, err := next.Open(secrets.Sealed{Ciphertext: ct, WrappedDEK: dek, KeyVersion: ver}, secrets.BackupTargetAAD(bid)); err != nil || !strings.Contains(string(pt), "rot-3") {
		t.Errorf("backup destination after rotation: %v", err)
	}
	_ = fx.Pool.QueryRow(ctx, `SELECT secret_ciphertext, secret_wrapped_dek, secret_key_version FROM cloud_accounts WHERE id = $1`, aid).Scan(&ct, &dek, &ver)
	if _, err := old.Open(secrets.Sealed{Ciphertext: ct, WrappedDEK: dek, KeyVersion: ver}, secrets.CloudAccountAAD(aid)); err == nil {
		t.Error("the old key still opens it")
	}
	// Startup check: the new key with the old version (forgotten NTB_MASTER_KEY_VERSION) is refused.
	q := store.New(fx.Pool)
	if err := rotate.CheckVersions(ctx, q, next); err != nil {
		t.Errorf("matching version refused: %v", err)
	}
	stale, _ := secrets.NewKeyringVersion(bytes.Repeat([]byte{9}, secrets.KeySize), 1)
	if err := rotate.CheckVersions(ctx, q, stale); err == nil {
		t.Error("a version mismatch was accepted")
	}
}

// P2-02 / P2-03 + P2-05: a credential due for change and a cloud account ending are announced like other dates.
func TestVaultAlerts(t *testing.T) {
	mail := useFakeMail(t)
	fx := newOrgFixture(t)
	org := fx.OrgA
	admin := fx.NewUser(t, "sysadmin-vault@example.com", true)
	if status, _ := saveSmtp(t, admin, map[string]any{"password": smtpSecret}); status != http.StatusOK {
		t.Fatal("smtp")
	}
	today := calendarToday()
	_, cr := fx.A.Do("POST", credsPath(org), map[string]any{"name": "Router admin", "kind": "ssh", "username": "admin", "rotateDays": 90,
		"lastRotatedOn": today.AddDate(0, 0, -85).Format("2006-01-02"), "devices": []any{}})
	cid := cr["credential"].(map[string]any)["id"].(string)
	fx.A.Do("POST", cloudPath(org), map[string]any{"provider": "meraki", "name": "Meraki HQ", "expiresOn": today.AddDate(0, 0, 10).Format("2006-01-02"), "deviceIds": []any{}})
	r := notify.Runner{Pool: fx.Pool, Keys: testKeyring(t), Send: sendMail, Logger: slog.New(slog.DiscardHandler)}
	now := time.Now()
	if err := r.RunOnce(context.Background(), time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.Local)); err != nil {
		t.Fatal(err)
	}
	if len(mail.sent) != 1 {
		t.Fatalf("digests: %d", len(mail.sent))
	}
	text := mail.sent[0].Text
	for _, want := range []string{"Đến hạn đổi mật khẩu", "Router admin", "/vault?credential=" + cid, "Tài khoản cloud hết hạn", "Meraki HQ"} {
		if !strings.Contains(text, want) {
			t.Errorf("digest misses %q:\n%s", want, text)
		}
	}
	_, bell := fx.A.Do("GET", orgPath(org)+"/notifications", nil)
	if len(bell["notifications"].([]any)) != 2 {
		t.Errorf("bell: %v", bell)
	}
}

// httptestReveal posts a reveal and returns the raw response (headers).
func httptestReveal(t *testing.T, fx *tenanttest.Fixture, org uuid.UUID, cid string) *http.Response {
	t.Helper()
	resp, _ := fx.A.Post(credsPath(org)+"/"+cid+"/reveal", map[string]any{"action": "reveal"})
	return resp
}
