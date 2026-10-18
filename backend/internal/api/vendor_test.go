package api

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenanttest"
)

func vendorsPath(org uuid.UUID) string   { return orgPath(org) + "/vendors" }
func contractsPath(org uuid.UUID) string { return orgPath(org) + "/contracts" }

// P2-04: vendors and their contacts — members read, editors write, names unique, audited, tenant-scoped.
func TestVendors(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	fx.AssertCrossTenantDenied(t, "GET", vendorsPath, nil)
	fx.AssertCrossTenantDenied(t, "POST", vendorsPath, map[string]any{"kind": "isp", "name": "Viettel"})

	v := mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "isp", "name": "Viettel", "supportPhone": "18008198",
		"website": "https://viettel.vn"})
	vid := v["id"].(string)
	for _, p := range []string{vendorsPath(fx.OrgB) + "/" + vid, vendorsPath(org) + "/" + vid} {
		if status, _ := fx.B.Do("GET", p, nil); status != http.StatusNotFound {
			t.Errorf("org B reading %s: %d", p, status)
		}
	}
	if status, _ := fx.A.Do("POST", vendorsPath(org), map[string]any{"kind": "isp", "name": "viettel"}); status != http.StatusConflict {
		t.Errorf("duplicate name: %d", status)
	}
	for _, bad := range []map[string]any{
		{"kind": "isp", "name": ""}, {"kind": "bank", "name": "X"}, {"kind": "isp", "name": "Y", "website": "javascript:alert(1)"},
		{"kind": "isp", "name": "Z", "supportEmail": "nope"},
	} {
		if status, _ := fx.A.Do("POST", vendorsPath(org), bad); status != http.StatusBadRequest {
			t.Errorf("%v: %d", bad, status)
		}
	}
	viewer := fx.NewUser(t, "viewer-vendor@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Do("POST", vendorsPath(org), map[string]any{"kind": "isp", "name": "FPT"}); status != http.StatusForbidden {
		t.Errorf("viewer creating: %d", status)
	}
	if status, list := viewer.Do("GET", vendorsPath(org), nil); status != http.StatusOK || len(list["vendors"].([]any)) != 1 {
		t.Errorf("viewer listing: %d %v", status, list)
	}

	c := mustCreate(t, fx.A, vendorsPath(org)+"/"+vid+"/contacts", map[string]any{"name": "Anh Nam", "phone": "0909", "email": "nam@viettel.vn"})
	c["phone"] = "0912"
	if status, got := fx.A.Do("PATCH", orgPath(org)+"/vendor-contacts/"+c["id"].(string), c); status != http.StatusOK || got["phone"] != "0912" {
		t.Errorf("edit contact: %d %v", status, got)
	}
	if status, _ := fx.B.Do("DELETE", orgPath(fx.OrgB)+"/vendor-contacts/"+c["id"].(string), nil); status != http.StatusNotFound {
		t.Errorf("org B deleting A's contact: %d", status)
	}
	_, detail := fx.A.Do("GET", vendorsPath(org)+"/"+vid, nil)
	if len(detail["contacts"].([]any)) != 1 || detail["vendor"].(map[string]any)["contactCount"] != float64(1) {
		t.Errorf("detail: %v", detail)
	}

	v["notes"] = "Kênh doanh nghiệp"
	if status, got := fx.A.Do("PATCH", vendorsPath(org)+"/"+vid, v); status != http.StatusOK || got["version"] != float64(2) {
		t.Fatalf("edit: %d %v", status, got)
	}
	if status, _ := fx.A.Do("PATCH", vendorsPath(org)+"/"+vid, v); status != http.StatusConflict {
		t.Errorf("stale edit: %d", status)
	}
	for _, a := range []string{"vendor.create", "vendor.update", "vendor_contact.create", "vendor_contact.update"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("%s not audited", a)
		}
	}
}

// P2-04: contracts cover devices and links of the organization; the lists replace on edit; a vendor with live
// contracts cannot go; a device's supplier.
func TestContracts(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	site := idOf(t, mustCreate(t, fx.A, sitesPath(org), map[string]any{"code": "HCM01", "name": "HCM"}))
	fw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "FW1", "type": "firewall", "siteId": site}))
	sw := idOf(t, mustCreate(t, fx.A, devicesPath(org), map[string]any{"hostname": "SW1", "type": "l2_switch", "siteId": site}))
	link := idOf(t, mustCreate(t, fx.A, linksPath(org), map[string]any{"a": devEnd(fw, ""), "b": devEnd(sw, ""), "kind": "ethernet"}))
	siteB := idOf(t, mustCreate(t, fx.B, sitesPath(fx.OrgB), map[string]any{"code": "HN01", "name": "HN"}))
	other := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B1", "type": "router", "siteId": siteB}))
	vid := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "supplier", "name": "Nhà phân phối A", "supportPhone": "1900"}))
	vB := idOf(t, mustCreate(t, fx.B, vendorsPath(fx.OrgB), map[string]any{"kind": "supplier", "name": "Của B"}))

	body := map[string]any{"vendorId": vid, "kind": "license", "name": "FortiGuard UTM 1 năm", "number": "HD-01",
		"startDate": "2026-01-01", "endDate": "2026-12-31", "deviceIds": []string{fw, fw}, "linkIds": []string{link}}
	status, k := fx.A.Do("POST", contractsPath(org), body)
	if status != http.StatusCreated || len(k["devices"].([]any)) != 1 || len(k["links"].([]any)) != 1 ||
		k["contract"].(map[string]any)["supportPhone"] != "1900" {
		t.Fatalf("create: %d %v", status, k)
	}
	kid := k["contract"].(map[string]any)["id"].(string)
	for _, p := range []string{contractsPath(fx.OrgB) + "/" + kid, contractsPath(org) + "/" + kid} {
		if status, _ := fx.B.Do("GET", p, nil); status != http.StatusNotFound {
			t.Errorf("org B reading %s: %d", p, status)
		}
	}
	for name, bad := range map[string]map[string]any{
		"other org's device": {"vendorId": vid, "kind": "support", "name": "x", "deviceIds": []string{other}, "linkIds": []string{}},
		"other org's vendor": {"vendorId": vB, "kind": "support", "name": "x", "deviceIds": []string{}, "linkIds": []string{}},
		"end before start":   {"vendorId": vid, "kind": "support", "name": "x", "startDate": "2026-05-01", "endDate": "2026-01-01", "deviceIds": []string{}, "linkIds": []string{}},
	} {
		if status, _ := fx.A.Do("POST", contractsPath(org), bad); status != http.StatusBadRequest {
			t.Errorf("%s: %d", name, status)
		}
	}
	other2 := idOf(t, mustCreate(t, fx.B, devicesPath(fx.OrgB), map[string]any{"hostname": "B2", "type": "l2_switch", "siteId": siteB}))
	linkB := idOf(t, mustCreate(t, fx.B, linksPath(fx.OrgB), map[string]any{"a": devEnd(other, ""), "b": devEnd(other2, ""), "kind": "ethernet"}))
	if status, _ := fx.A.Do("POST", contractsPath(org), map[string]any{"vendorId": vid, "kind": "isp", "name": "x",
		"deviceIds": []string{}, "linkIds": []string{linkB}}); status != http.StatusBadRequest {
		t.Errorf("other org's link: %d", status)
	}
	// Org B reaches nothing of A's: not through its own path, not through A's.
	for _, c := range []struct{ method, path string }{
		{"PATCH", contractsPath(fx.OrgB) + "/" + kid}, {"DELETE", contractsPath(fx.OrgB) + "/" + kid},
		{"PATCH", contractsPath(org) + "/" + kid}, {"DELETE", vendorsPath(fx.OrgB) + "/" + vid},
		{"PATCH", vendorsPath(fx.OrgB) + "/" + vid},
	} {
		b := map[string]any{"vendorId": vid, "kind": "license", "name": "x", "deviceIds": []string{}, "linkIds": []string{}, "version": 1}
		if strings.Contains(c.path, "/vendors/") {
			b = map[string]any{"kind": "supplier", "name": "Đổi tên", "version": 1}
		}
		if status, _ := fx.B.Do(c.method, c.path, b); status != http.StatusNotFound {
			t.Errorf("org B %s %s: %d", c.method, c.path, status)
		}
	}
	if _, list := fx.B.Do("GET", contractsPath(fx.OrgB)+"?deviceId="+fw, nil); len(list["contracts"].([]any)) != 0 {
		t.Errorf("org B listing A's device contracts: %v", list)
	}
	if _, list := fx.A.Do("GET", contractsPath(org)+"?deviceId="+fw, nil); len(list["contracts"].([]any)) != 1 {
		t.Errorf("by device: %v", list)
	}
	if _, list := fx.A.Do("GET", contractsPath(org)+"?deviceId="+sw, nil); len(list["contracts"].([]any)) != 0 {
		t.Errorf("not covering SW1: %v", list)
	}
	body["deviceIds"], body["linkIds"], body["version"] = []string{sw}, []string{}, 1
	if status, got := fx.A.Do("PATCH", contractsPath(org)+"/"+kid, body); status != http.StatusOK ||
		len(got["devices"].([]any)) != 1 || got["devices"].([]any)[0].(map[string]any)["hostname"] != "SW1" || len(got["links"].([]any)) != 0 {
		t.Fatalf("replace items: %d %v", status, got)
	}
	if status, _ := fx.A.Do("PATCH", contractsPath(org)+"/"+kid, body); status != http.StatusConflict {
		t.Errorf("stale: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", vendorsPath(org)+"/"+vid, nil); status != http.StatusConflict {
		t.Errorf("vendor with a contract deleted: %d", status)
	}

	// Supplier of a device.
	sup := func(c *tenanttest.Client, o uuid.UUID, dev string, id any) int {
		status, _ := c.Do("PUT", devicePath(o, dev)+"/supplier", map[string]any{"supplierId": id})
		return status
	}
	if sup(fx.A, org, fw, vB) != http.StatusBadRequest || sup(fx.A, org, fw, vid) != http.StatusNoContent {
		t.Error("supplier choice")
	}
	if _, d := fx.A.Do("GET", devicePath(org, fw), nil); d["supplierId"] != vid {
		t.Errorf("device supplier: %v", d["supplierId"])
	}
	if sup(fx.B, fx.OrgB, fw, nil) != http.StatusNotFound {
		t.Error("org B setting A's device supplier")
	}

	if status, _ := fx.A.Do("DELETE", contractsPath(org)+"/"+kid, nil); status != http.StatusNoContent {
		t.Fatalf("delete contract: %d", status)
	}
	if status, _ := fx.A.Do("DELETE", vendorsPath(org)+"/"+vid, nil); status != http.StatusNoContent {
		t.Fatalf("delete vendor: %d", status)
	}
	if _, d := fx.A.Do("GET", devicePath(org, fw), nil); d["supplierId"] != nil {
		t.Errorf("supplier kept after its vendor went: %v", d["supplierId"])
	}
	for _, a := range []string{"contract.create", "contract.update", "contract.delete", "vendor.delete", "device.supplier"} {
		if auditCount(t, fx.Pool, a, org) == 0 {
			t.Errorf("%s not audited", a)
		}
	}
}

// P2-04: files attached to a contract — allowed kinds checked on the content, size capped, always downloaded as an
// attachment, tenant-scoped.
func TestContractFiles(t *testing.T) {
	fx := newOrgFixture(t)
	org := fx.OrgA
	vid := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "maintenance", "name": "Bảo trì X"}))
	_, k := fx.A.Do("POST", contractsPath(org), map[string]any{"vendorId": vid, "kind": "maintenance", "name": "Bảo trì 2026",
		"deviceIds": []string{}, "linkIds": []string{}})
	kid := k["contract"].(map[string]any)["id"].(string)
	files := contractsPath(org) + "/" + kid + "/files"

	pdf := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("x"), 2000)...)
	status, f := fx.A.Upload(files, `..\..\Hợp đồng "bảo trì".pdf`, pdf)
	if status != http.StatusCreated || f["contentType"] != "application/pdf" || f["size"] != float64(len(pdf)) ||
		strings.ContainsAny(f["name"].(string), `\/`) {
		t.Fatalf("upload: %d %v", status, f)
	}
	for name, data := range map[string][]byte{
		"virus.exe": []byte("MZ...."),
		"fake.pdf":  []byte("<html><script>alert(1)</script></html>"),
		"empty.pdf": {},
		"huge.pdf":  append([]byte("%PDF-1.4\n"), make([]byte, maxFileSize)...),
		"page.html": []byte("<html></html>"),
	} {
		if status, _ := fx.A.Upload(files, name, data); status != http.StatusBadRequest && status != http.StatusRequestEntityTooLarge {
			t.Errorf("%s accepted: %d", name, status)
		}
	}
	viewer := fx.NewUser(t, "viewer-files@example.com", false, tenanttest.Member{Org: org, Role: "viewer"})
	if status, _ := viewer.Upload(files, "a.pdf", pdf); status != http.StatusForbidden {
		t.Errorf("viewer uploading: %d", status)
	}
	if status, _ := fx.B.Upload(contractsPath(fx.OrgB)+"/"+kid+"/files", "a.pdf", pdf); status != http.StatusNotFound {
		t.Errorf("org B uploading to A's contract: %d", status)
	}

	fileURL := orgPath(org) + "/files/" + f["id"].(string)
	resp, got := viewer.Raw(fileURL)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, pdf) || resp.Header.Get("Content-Type") != "application/octet-stream" ||
		!strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment;") || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("download: %d %v", resp.StatusCode, resp.Header)
	}
	if resp, _ := fx.B.Raw(orgPath(fx.OrgB) + "/files/" + f["id"].(string)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("org B downloading: %d", resp.StatusCode)
	}
	if status, _ := fx.B.Do("DELETE", orgPath(fx.OrgB)+"/files/"+f["id"].(string), nil); status != http.StatusNotFound {
		t.Errorf("org B deleting A's file: %d", status)
	}
	if resp.Header.Get("Cache-Control") != "private, no-store" {
		t.Errorf("download cache: %q", resp.Header.Get("Cache-Control"))
	}
	// A huge or tricky name is cut to its end (the extension stays), bidi overrides removed.
	status, long := fx.A.Upload(files, strings.Repeat("a", 200000)+"\u202Efdp.pdf", pdf)
	if status != http.StatusCreated || len(long["name"].(string)) > 255 || !strings.HasSuffix(long["name"].(string), ".pdf") ||
		strings.Contains(long["name"].(string), "\u202E") {
		t.Errorf("long name: %d %v", status, len(long["name"].(string)))
	}
	if status, _ := fx.A.Do("DELETE", fileURL, nil); status != http.StatusNoContent {
		t.Errorf("delete file: %d", status)
	}
	if auditCount(t, fx.Pool, "file.upload", org) != 2 || auditCount(t, fx.Pool, "file.delete", org) != 1 {
		t.Error("files not audited")
	}
	// Deleting the contract removes its remaining files.
	if status, _ := fx.A.Do("DELETE", contractsPath(org)+"/"+kid, nil); status != http.StatusNoContent {
		t.Fatalf("delete contract: %d", status)
	}
	var left int
	_ = fx.Pool.QueryRow(context.Background(), `SELECT count(*) FROM files WHERE contract_id = $1`, kid).Scan(&left)
	if left != 0 {
		t.Errorf("%d files left behind", left)
	}
}

// P2-04 + P2-05: a contract ending soon is announced once, in the digest, with a link to it.
func TestContractAlerts(t *testing.T) {
	mail := useFakeMail(t)
	fx := newOrgFixture(t)
	org := fx.OrgA
	admin := fx.NewUser(t, "sysadmin-contract@example.com", true)
	if status, _ := saveSmtp(t, admin, map[string]any{"password": smtpSecret}); status != http.StatusOK {
		t.Fatal("smtp")
	}
	now := time.Now()
	vid := idOf(t, mustCreate(t, fx.A, vendorsPath(org), map[string]any{"kind": "isp", "name": "FPT Telecom"}))
	_, k := fx.A.Do("POST", contractsPath(org), map[string]any{"vendorId": vid, "kind": "isp", "name": "Leased line 100M",
		"endDate": now.AddDate(0, 0, 20).Format("2006-01-02"), "deviceIds": []string{}, "linkIds": []string{}})
	kid := k["contract"].(map[string]any)["id"].(string)
	r := notify.Runner{Pool: fx.Pool, Keys: testKeyring(t), Send: sendMail, Logger: slog.New(slog.DiscardHandler)}
	if err := r.RunOnce(context.Background(), time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.Local)); err != nil {
		t.Fatal(err)
	}
	if len(mail.sent) != 1 || !strings.Contains(mail.sent[0].Text, "Hợp đồng hết hạn") || !strings.Contains(mail.sent[0].Text, "Leased line 100M") ||
		!strings.Contains(mail.sent[0].Text, "/contracts/"+kid) || !strings.Contains(mail.sent[0].Text, "FPT Telecom") {
		t.Fatalf("digest: %+v", mail.sent)
	}
	_, bell := fx.A.Do("GET", orgPath(org)+"/notifications", nil)
	n := bell["notifications"].([]any)
	if len(n) != 1 || n[0].(map[string]any)["contractId"] != kid || n[0].(map[string]any)["deviceId"] != nil {
		t.Errorf("bell: %v", bell)
	}
}
