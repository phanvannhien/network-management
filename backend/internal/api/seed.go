package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Sample data and benchmark inventories (P1-25), written through the same handlers as the UI — organization,
// categories, sites, then a .ntb.json file (ADR-037) per diagram — so they obey every rule and land in the audit log.
// Names and serial numbers are made up.

// SeedResult says what a seed created.
type SeedResult struct {
	OrgID    uuid.UUID
	OrgName  string
	Devices  int
	Links    int
	Diagrams []string
}

// seedSession is the context of a CLI seed acting as the given system administrator.
func (s *Server) seedSession(ctx context.Context, email string) (context.Context, store.User, error) {
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, u, fmt.Errorf("no user %s: create one with `ntb admin create`", email)
	}
	if err != nil {
		return nil, u, fmt.Errorf("find user: %w", err)
	}
	if !u.IsSystemAdmin {
		return nil, u, fmt.Errorf("%s is not a system administrator", email)
	}
	ctx = context.WithValue(ctx, ctxSession, auth.Session{UserID: u.ID, Email: u.Email, IsSystemAdmin: true, MFAVerified: true})
	ctx = context.WithValue(ctx, ctxMeta, requestInfo{meta: auth.RequestMeta{UserAgent: "ntb seed"}})
	return ctx, u, nil
}

// seedOrg creates an organization owned by the seeding user and returns a context acting in it.
func (s *Server) seedOrg(ctx context.Context, u store.User, name, code string, kind apigen.OrganizationKind, notes string) (context.Context, uuid.UUID, error) {
	res, err := s.AdminCreateOrganization(ctx, apigen.AdminCreateOrganizationRequestObject{Body: &apigen.CreateOrganizationRequest{
		Name: name, Code: &code, Kind: kind, Notes: &notes,
	}})
	if err != nil {
		return nil, uuid.Nil, err
	}
	org, ok := res.(apigen.AdminCreateOrganization201JSONResponse)
	if !ok {
		return nil, uuid.Nil, fmt.Errorf("create organization %s: %+v", name, res)
	}
	m := tenant.Membership{OrgID: pgUUID(org.Id), UserID: u.ID, Role: tenant.RoleOwner, OrgName: name, OrgKind: string(kind)}
	return tenant.WithMembership(ctx, m), org.Id, nil
}

func (s *Server) seedCategory(ctx context.Context, org uuid.UUID, code, name string) (uuid.UUID, error) {
	res, err := s.CreateCategory(ctx, apigen.CreateCategoryRequestObject{OrgId: org, Body: &apigen.CategoryInput{Code: code, Name: name}})
	if err != nil {
		return uuid.Nil, err
	}
	c, ok := res.(apigen.CreateCategory201JSONResponse)
	if !ok {
		return uuid.Nil, fmt.Errorf("create category %s: %+v", code, res)
	}
	return c.Id, nil
}

func (s *Server) seedSite(ctx context.Context, org uuid.UUID, category *uuid.UUID, code, name string, kind apigen.SiteKind, isp string) (uuid.UUID, error) {
	in := apigen.SiteInput{Code: code, Name: name, Kind: &kind, CategoryId: category}
	if isp != "" {
		in.Isp = &isp
	}
	res, err := s.CreateSite(ctx, apigen.CreateSiteRequestObject{OrgId: org, Body: &in})
	if err != nil {
		return uuid.Nil, err
	}
	st, ok := res.(apigen.CreateSite201JSONResponse)
	if !ok {
		return uuid.Nil, fmt.Errorf("create site %s: %+v", code, res)
	}
	return st.Id, nil
}

// seedImport writes one diagram and everything on it.
func (s *Server) seedImport(ctx context.Context, org uuid.UUID, b *ntbBuilder, sites map[string]uuid.UUID) (apigen.NtbImportResult, error) {
	raw, err := json.Marshal(b.f)
	if err != nil {
		return apigen.NtbImportResult{}, fmt.Errorf("encode file: %w", err)
	}
	var doc apigen.NtbFile
	if err := json.Unmarshal(raw, &doc); err != nil {
		return apigen.NtbImportResult{}, fmt.Errorf("decode file: %w", err)
	}
	res, err := s.ImportNtb(ctx, apigen.ImportNtbRequestObject{OrgId: org, Body: &apigen.NtbImport{
		File: doc, SiteMap: sites, DiagramName: b.f.Diagram.Name, DeviceActions: map[string]apigen.NtbImportDeviceActions{},
	}})
	if err != nil {
		return apigen.NtbImportResult{}, err
	}
	out, ok := res.(apigen.ImportNtb200JSONResponse)
	if !ok {
		return apigen.NtbImportResult{}, fmt.Errorf("import %s: %+v", b.f.Diagram.Name, res)
	}
	return apigen.NtbImportResult(out), nil
}

// --- .ntb.json builder ---

type ntbBuilder struct {
	f      ntbFile
	seq    int
	ports  map[string]map[string]string // device ref → port name → interface ref
	serial int
}

func newNtbBuilder(name, layer string) *ntbBuilder {
	return &ntbBuilder{
		f: ntbFile{SchemaVersion: "2.0.0", ExportedAt: "2026-10-17T00:00:00Z", Source: &ntbSource{App: "ntb seed"},
			Diagram: ntbDiagram{Name: name, Layer: layer, View: ntbView{Nodes: []ntbNode{}, Edges: []ntbEdge{}, Annotations: []ntbAnnotation{}}},
			Sites:   []ntbSite{}, Clusters: []ntbCluster{}, Devices: []ntbDevice{}, Interfaces: []ntbInterface{}, IPs: []ntbIP{},
			Subnets: []ntbSubnet{}, Ranges: []ntbRange{}, EndpointGroups: []ntbGroup{}, Links: []ntbLink{}},
		ports: map[string]map[string]string{},
	}
}

func (b *ntbBuilder) ref(prefix string) string {
	b.seq++
	return fmt.Sprintf("%s-%d", prefix, b.seq)
}

func (b *ntbBuilder) site(code, name string) string {
	r := b.ref("site")
	b.f.Sites = append(b.f.Sites, ntbSite{Ref: r, Code: code, Name: name})
	return r
}

// fakeSerial returns a made-up serial number in the vendor's style.
func (b *ntbBuilder) fakeSerial(prefix string) string {
	b.serial++
	return fmt.Sprintf("%s%07X", prefix, 0x2312A0+b.serial*37)
}

type seedDevice struct {
	site, hostname, catalogID, role, serialPrefix string
	typ                                           string // when not from the catalog
	cluster                                       string
	member                                        int32
	x, y                                          float32
}

// device adds a device with the catalog model's ports, placed at (x, y) on the diagram.
func (b *ntbBuilder) device(d seedDevice) string {
	r := b.ref("dev")
	dev := ntbDevice{Ref: r, SiteRef: d.site, Hostname: d.hostname, Type: d.typ, Role: d.role, Lifecycle: "active"}
	b.ports[r] = map[string]string{}
	if m, ok := catalog.Get(d.catalogID); ok {
		dev.Type, dev.Vendor, dev.Model, dev.CatalogID, dev.UHeight = string(m.Type), m.Vendor, m.Model, m.Id, m.UHeight
		if len(m.PartNumbers) > 0 {
			dev.PartNumber = m.PartNumbers[0]
		}
		ports, msg := expandPorts(m.Ports, max(d.member, 1))
		if msg != "" {
			panic("catalog " + d.catalogID + ": " + msg)
		}
		for _, p := range ports {
			ir := b.ref("if")
			b.f.Interfaces = append(b.f.Interfaces, ntbInterface{Ref: ir, DeviceRef: r, Name: p.name, Kind: "physical", Media: p.media, Speed: p.speed, Poe: p.poe})
			b.ports[r][p.name] = ir
		}
	}
	if d.serialPrefix != "" {
		dev.SerialNumber = b.fakeSerial(d.serialPrefix)
	}
	if dev.Type == "provider_cloud" {
		f := false
		dev.Managed = &f
	}
	if d.cluster != "" {
		dev.ClusterRef = &d.cluster
		no := d.member
		dev.ClusterMemberNo = &no
		role := "secondary"
		if d.member == 1 {
			role = "primary"
		}
		dev.ClusterRole = &role
	}
	b.f.Devices = append(b.f.Devices, dev)
	b.f.Diagram.View.Nodes = append(b.f.Diagram.View.Nodes, ntbNode{ID: "n-" + r, RefKind: "device", RefID: r, X: d.x, Y: d.y})
	return r
}

// iface returns the device's port, adding a logical interface (SVI, tunnel) when it has none of that name.
func (b *ntbBuilder) iface(dev, name, kind string) string {
	if r, ok := b.ports[dev][name]; ok {
		return r
	}
	r := b.ref("if")
	b.f.Interfaces = append(b.f.Interfaces, ntbInterface{Ref: r, DeviceRef: dev, Name: name, Kind: kind})
	b.ports[dev][name] = r
	return r
}

// mgmt puts the device's management address on an interface and makes it the management interface.
func (b *ntbBuilder) mgmt(dev, ifName, kind, addr string) {
	ir := b.iface(dev, ifName, kind)
	b.ip(dev, ir, addr, "")
	for i := range b.f.Devices {
		if b.f.Devices[i].Ref == dev {
			b.f.Devices[i].MgmtInterfaceRef = &ir
		}
	}
}

func (b *ntbBuilder) ip(dev, ifRef, addr, desc string) {
	b.f.IPs = append(b.f.IPs, ntbIP{DeviceRef: dev, InterfaceRef: &ifRef, Address: addr, Role: "primary", Description: desc})
}

// link cables two ports (or ends without a port when name is "") and draws it.
func (b *ntbBuilder) link(aDev, aPort, bDev, bPort, kind string, opt ntbLink) {
	end := func(dev, port string) ntbEnd {
		e := ntbEnd{Kind: "device", Ref: dev}
		if port != "" {
			ir := b.iface(dev, port, "physical")
			e.InterfaceRef = &ir
		}
		return e
	}
	l := opt
	l.Ref, l.Kind, l.A, l.B = b.ref("link"), kind, end(aDev, aPort), end(bDev, bPort)
	if l.Status == "" {
		l.Status = "up"
	}
	b.f.Links = append(b.f.Links, l)
	b.f.Diagram.View.Edges = append(b.f.Diagram.View.Edges, ntbEdge{ID: "e-" + l.Ref, LinkRef: l.Ref})
}

func (b *ntbBuilder) group(site, kind, name string, count int32, x, y float32) string {
	r := b.ref("grp")
	b.f.EndpointGroups = append(b.f.EndpointGroups, ntbGroup{Ref: r, SiteRef: site, Kind: kind, Name: name, ExpectedCount: &count})
	b.f.Diagram.View.Nodes = append(b.f.Diagram.View.Nodes, ntbNode{ID: "n-" + r, RefKind: "endpoint_group", RefID: r, X: x, Y: y})
	return r
}

func (b *ntbBuilder) groupLink(grp, dev, port string) {
	ir := b.iface(dev, port, "physical")
	l := ntbLink{Ref: b.ref("link"), Kind: "ethernet", Status: "up", A: ntbEnd{Kind: "endpoint_group", Ref: grp}, B: ntbEnd{Kind: "device", Ref: dev, InterfaceRef: &ir}}
	b.f.Links = append(b.f.Links, l)
	b.f.Diagram.View.Edges = append(b.f.Diagram.View.Edges, ntbEdge{ID: "e-" + l.Ref, LinkRef: l.Ref})
}

// frame draws the box of a site around its devices.
func (b *ntbBuilder) frame(site, title string, x, y, w, h float32) {
	sr := site
	b.f.Diagram.View.Annotations = append(b.f.Diagram.View.Annotations, ntbAnnotation{ID: b.ref("frame"), Kind: "zone", X: x, Y: y, Width: &w, Height: &h, Text: title, SiteRef: &sr})
}

// --- "Tập đoàn Mẫu" (PLAN P1-25) ---

const (
	demoOrgName = "Tập đoàn Mẫu"
	nodeGapX    = 200
	nodeGapY    = 150
)

// SeedDemo creates the sample organization "Tập đoàn Mẫu": an IDC with a FortiGate HA pair straight under the
// organization, categories "Mẫu Food" (Hà Nội, HCM) and "Mẫu Agri" (six sites with one router each, VPN to the IDC),
// and the older "Văn phòng mẫu" office as a third category with its own LAN diagram.
func (s *Server) SeedDemo(ctx context.Context, ownerEmail string) (SeedResult, error) {
	ctx, u, err := s.seedSession(ctx, ownerEmail)
	if err != nil {
		return SeedResult{}, err
	}
	orgs, err := s.q.ListUserOrganizationNames(ctx, u.ID)
	if err != nil {
		return SeedResult{}, fmt.Errorf("list organizations: %w", err)
	}
	for _, o := range orgs {
		if o == demoOrgName {
			return SeedResult{}, fmt.Errorf("%s already exists (delete it in Hệ thống › Tổ chức to seed again)", demoOrgName)
		}
	}
	ctx, org, err := s.seedOrg(ctx, u, demoOrgName, "MAU", apigen.Customer, "Dữ liệu mẫu (tên và số seri giả) — P1-25")
	if err != nil {
		return SeedResult{}, err
	}
	out := SeedResult{OrgID: org, OrgName: demoOrgName}
	food, err := s.seedCategory(ctx, org, "FOOD", "Mẫu Food")
	if err != nil {
		return out, err
	}
	agri, err := s.seedCategory(ctx, org, "AGRI", "Mẫu Agri")
	if err != nil {
		return out, err
	}
	vpm, err := s.seedCategory(ctx, org, "VPM", "Văn phòng mẫu")
	if err != nil {
		return out, err
	}

	type siteSpec struct {
		code, name string
		cat        *uuid.UUID
		kind       apigen.SiteKind
		isp        string
	}
	specs := []siteSpec{
		{"IDC", "IDC HCM", nil, apigen.SiteKindDatacenter, "FPT Telecom"},
		{"HN01", "Văn phòng Hà Nội", &food, apigen.SiteKindOffice, "Viettel"},
		{"HCM01", "Văn phòng HCM", &food, apigen.SiteKindOffice, "FPT Telecom"},
		{"HY01", "Hưng Yên", &agri, apigen.SiteKindFactory, "VNPT"},
		{"VL01", "Vĩnh Long", &agri, apigen.SiteKindFactory, "VNPT"},
		{"BD01", "Bình Định – nhà máy", &agri, apigen.SiteKindFactory, "Viettel"},
		{"BC01", "Bến Cát", &agri, apigen.SiteKindFactory, "FPT Telecom"},
		{"BH01", "Biên Hòa", &agri, apigen.SiteKindFactory, "Viettel"},
		{"HCM01", "Văn phòng HCM (Agri)", &agri, apigen.SiteKindOffice, "FPT Telecom"},
		{"HQ01", "Trụ sở Văn phòng mẫu", &vpm, apigen.SiteKindOffice, "FPT Telecom"},
	}
	siteIDs := make([]uuid.UUID, len(specs))
	for i, sp := range specs {
		if siteIDs[i], err = s.seedSite(ctx, org, sp.cat, sp.code, sp.name, sp.kind, sp.isp); err != nil {
			return out, err
		}
	}

	// Overview: IDC in the middle, Food on the left, Agri branches in a row below.
	b := newNtbBuilder("Tập đoàn Mẫu — tổng quan", "overview")
	sites := map[string]uuid.UUID{}
	ref := make([]string, len(specs))
	for i, sp := range specs[:9] {
		ref[i] = b.site(sp.code, sp.name)
		sites[ref[i]] = siteIDs[i]
	}
	idcX, idcY := float32(1200), float32(80)
	b.frame(ref[0], "IDC HCM", idcX-40, idcY-50, 3*nodeGapX+80, 2*nodeGapY+60)
	inet := b.device(seedDevice{site: ref[0], hostname: "Internet-FPT", typ: "provider_cloud", x: idcX + nodeGapX, y: idcY})
	ha := b.ref("cl")
	b.f.Clusters = append(b.f.Clusters, ntbCluster{Ref: ha, SiteRef: ref[0], Kind: "ha_active_passive", Name: "IDC-FW-HA", Hostname: "FW-IDC", MgmtIP: "10.136.4.101/24"})
	fw1 := b.device(seedDevice{site: ref[0], hostname: "FW-IDC-01", catalogID: "fortinet-fortigate-80f", role: "edge", serialPrefix: "FGT80F", cluster: ha, member: 1, x: idcX + nodeGapX/2, y: idcY + nodeGapY})
	fw2 := b.device(seedDevice{site: ref[0], hostname: "FW-IDC-02", catalogID: "fortinet-fortigate-80f", role: "edge", serialPrefix: "FGT80F", cluster: ha, member: 2, x: idcX + nodeGapX*3/2, y: idcY + nodeGapY})
	b.link(fw1, "wan1", inet, "", "ethernet", ntbLink{Service: "internet_dedicated", Provider: "FPT Telecom", Bandwidth: "300M"})
	b.link(fw2, "wan1", inet, "", "ethernet", ntbLink{Service: "internet_dedicated", Provider: "FPT Telecom", Bandwidth: "300M"})
	b.link(fw1, "a", fw2, "a", "stack", ntbLink{Notes: "HA heartbeat"})
	tunnels := 0
	vpn := func(router, routerSite string) {
		tunnels++
		base := 4 * tunnels
		rt := b.iface(router, "Tunnel1", "tunnel")
		ft := b.iface(fw1, "VPN-"+routerSite, "tunnel")
		b.ip(router, rt, fmt.Sprintf("10.136.255.%d/30", base+2), "VPN về IDC")
		b.ip(fw1, ft, fmt.Sprintf("10.136.255.%d/30", base+1), "VPN "+routerSite)
		b.f.Links = append(b.f.Links, ntbLink{Ref: b.ref("link"), Kind: "logical", Medium: "VPN/IPsec", Status: "up",
			A: ntbEnd{Kind: "device", Ref: router, InterfaceRef: &rt}, B: ntbEnd{Kind: "device", Ref: fw1, InterfaceRef: &ft}})
		last := b.f.Links[len(b.f.Links)-1]
		b.f.Diagram.View.Edges = append(b.f.Diagram.View.Edges, ntbEdge{ID: "e-" + last.Ref, LinkRef: last.Ref})
	}

	// Mẫu Food — Hà Nội: router + switch; HCM: four switches.
	hnX, hnY := float32(80), float32(80)
	b.frame(ref[1], "Mẫu Food · Hà Nội", hnX-40, hnY-50, nodeGapX+80, 2*nodeGapY+60)
	rHN := b.device(seedDevice{site: ref[1], hostname: "R-HN-01", catalogID: "cisco-isr4331", role: "edge", serialPrefix: "FDO", x: hnX, y: hnY})
	swHN := b.device(seedDevice{site: ref[1], hostname: "SW-HN-01", catalogID: "cisco-cbs220-24t-4g", role: "access", serialPrefix: "DNI", x: hnX, y: hnY + nodeGapY})
	b.mgmt(rHN, "GigabitEthernet0/0/1", "physical", "10.136.41.1/24")
	b.mgmt(swHN, "Vlan1", "svi", "10.136.41.2/24")
	b.link(rHN, "GigabitEthernet0/0/1", swHN, "GE1", "ethernet", ntbLink{Medium: "Cat6"})
	vpn(rHN, "HN01")
	hcmX, hcmY := float32(420), float32(80)
	b.frame(ref[2], "Mẫu Food · HCM", hcmX-40, hcmY-50, 3*nodeGapX+80, 2*nodeGapY+60)
	var hcm []string
	for i := 0; i < 4; i++ {
		x, y := hcmX+float32(i-1)*nodeGapX, hcmY+nodeGapY
		if i == 0 {
			x, y = hcmX+nodeGapX, hcmY
		}
		sw := b.device(seedDevice{site: ref[2], hostname: fmt.Sprintf("SW-HCM-%02d", i+1), catalogID: "cisco-c1300-24t-4g", role: "access", serialPrefix: "DNI", x: x, y: y})
		b.mgmt(sw, "Vlan1", "svi", fmt.Sprintf("10.136.162.%d/24", 4+i))
		hcm = append(hcm, sw)
	}
	for i, sw := range hcm[1:] {
		b.link(hcm[0], fmt.Sprintf("GigabitEthernet1/0/%d", 21+i), sw, "GigabitEthernet1/0/24", "ethernet", ntbLink{Medium: "Cat6"})
	}

	// Mẫu Agri — six sites, one router each (PLAN: ISR4331 / ISR4321 / C2921 / C2911 / C2951).
	agriRouters := []struct{ catalogID, wan, lan string }{
		{"cisco-isr4331", "GigabitEthernet0/0/0", "GigabitEthernet0/0/1"},
		{"cisco-isr4321", "GigabitEthernet0/0/0", "GigabitEthernet0/0/1"},
		{"cisco-c2921", "GigabitEthernet0/0", "GigabitEthernet0/1"},
		{"cisco-c2911", "GigabitEthernet0/0", "GigabitEthernet0/1"},
		{"cisco-c2951", "GigabitEthernet0/0", "GigabitEthernet0/1"},
		{"cisco-isr4331", "GigabitEthernet0/0/0", "GigabitEthernet0/0/1"},
	}
	agriY := float32(520)
	for i, rt := range agriRouters {
		sp := specs[3+i]
		x := float32(80) + float32(i)*(nodeGapX+60)
		b.frame(ref[3+i], "Mẫu Agri · "+sp.name, x-40, agriY-50, nodeGapX+20, nodeGapY)
		r := b.device(seedDevice{site: ref[3+i], hostname: "R-" + strings.TrimSuffix(sp.code, "01") + "-01", catalogID: rt.catalogID, role: "edge", serialPrefix: "FTX", x: x, y: agriY})
		b.mgmt(r, rt.lan, "physical", fmt.Sprintf("10.136.%d.1/24", 61+i))
		vpn(r, sp.code)
	}
	res, err := s.seedImport(ctx, org, b, sites)
	if err != nil {
		return out, err
	}
	out.Devices += res.Created.Devices
	out.Links += res.Created.Links
	out.Diagrams = append(out.Diagrams, b.f.Diagram.Name)

	// Văn phòng mẫu — the older sample office (FortiGate 60F, core, three PoE switches, APs and cameras).
	serial := b.serial // made-up serials stay unique across the two files
	b = newNtbBuilder("Văn phòng mẫu — LAN trụ sở", "physical")
	b.serial = serial
	hq := b.site("HQ01", "Trụ sở Văn phòng mẫu")
	sites = map[string]uuid.UUID{hq: siteIDs[9]}
	b.frame(hq, "Văn phòng mẫu · Trụ sở", 40, 30, 4*nodeGapX+40, 4*nodeGapY+20)
	inetHQ := b.device(seedDevice{site: hq, hostname: "Internet-HQ", typ: "provider_cloud", x: 80 + nodeGapX*3/2, y: 80})
	fwHQ := b.device(seedDevice{site: hq, hostname: "FW-HQ-01", catalogID: "fortinet-fortigate-60f", role: "edge", serialPrefix: "FGT60F", x: 80 + nodeGapX*3/2, y: 80 + nodeGapY})
	core := b.device(seedDevice{site: hq, hostname: "CORE-HQ-01", catalogID: "cisco-c9300-24t", role: "core", serialPrefix: "FOC", x: 80 + nodeGapX*3/2, y: 80 + 2*nodeGapY})
	b.mgmt(fwHQ, "internal1", "physical", "10.72.114.1/24")
	b.mgmt(core, "Vlan10", "svi", "10.72.114.2/24")
	b.link(fwHQ, "wan1", inetHQ, "", "ethernet", ntbLink{Service: "internet_broadband", Provider: "FPT Telecom", Bandwidth: "200M"})
	b.link(fwHQ, "internal1", core, "GigabitEthernet1/0/1", "ethernet", ntbLink{Medium: "Cat6"})
	var access []string
	for i := 0; i < 3; i++ {
		sw := b.device(seedDevice{site: hq, hostname: fmt.Sprintf("SW-HQ-%02d", i+1), catalogID: "cisco-c1300-24p-4g", role: "access", serialPrefix: "DNI",
			x: 80 + float32(i)*nodeGapX*3/2, y: 80 + 3*nodeGapY})
		b.mgmt(sw, "Vlan10", "svi", fmt.Sprintf("10.72.114.%d/24", 11+i))
		b.link(core, fmt.Sprintf("GigabitEthernet1/0/%d", 2+i), sw, "GigabitEthernet1/0/24", "ethernet", ntbLink{Medium: "Cat6"})
		access = append(access, sw)
	}
	aps := b.group(hq, "access_point", "Wi-Fi tầng 1–3", 6, 80, 80+4*nodeGapY)
	cams := b.group(hq, "ip_camera", "Camera", 12, 80+nodeGapX*3/2, 80+4*nodeGapY)
	prn := b.group(hq, "printer", "Máy in", 4, 80+nodeGapX*3, 80+4*nodeGapY)
	b.groupLink(aps, access[0], "GigabitEthernet1/0/1")
	b.groupLink(cams, access[1], "GigabitEthernet1/0/1")
	b.groupLink(prn, access[2], "GigabitEthernet1/0/1")
	if res, err = s.seedImport(ctx, org, b, sites); err != nil {
		return out, err
	}
	out.Devices += res.Created.Devices
	out.Links += res.Created.Links
	out.Diagrams = append(out.Diagrams, b.f.Diagram.Name)
	return out, nil
}

// --- benchmark (PLAN P1-25, SRS §14) ---

// benchSiteSize: devices per site — a router, two core switches and access switches each cabled to both cores.
const benchSiteSize = 40

// SeedBench creates an organization "Benchmark <n> thiết bị" with n devices in sites of 40 (router, two cores,
// access switches with two uplinks: about two cables per device, as SRS §14's "500 devices + 1000 links") on one
// physical diagram.
func (s *Server) SeedBench(ctx context.Context, ownerEmail string, n int) (SeedResult, error) {
	if n < benchSiteSize || n > 5000 {
		return SeedResult{}, fmt.Errorf("devices: %d to 5000", benchSiteSize)
	}
	ctx, u, err := s.seedSession(ctx, ownerEmail)
	if err != nil {
		return SeedResult{}, err
	}
	name := fmt.Sprintf("Benchmark %d thiết bị", n)
	ctx, org, err := s.seedOrg(ctx, u, name, fmt.Sprintf("B%d", n), apigen.Internal, "Dữ liệu đo hiệu năng — P1-25")
	if err != nil {
		return SeedResult{}, err
	}
	out := SeedResult{OrgID: org, OrgName: name}
	cat, err := s.seedCategory(ctx, org, "BENCH", "Benchmark")
	if err != nil {
		return out, err
	}
	b := newNtbBuilder(fmt.Sprintf("Benchmark %d", n), "physical")
	sites := map[string]uuid.UUID{}
	const perRow, cols = 10, 4 // access switches per row inside a site; sites per row
	siteW, siteH := float32(perRow*nodeGapX+80), float32(6*nodeGapY+60)
	made := 0
	for si := 0; made < n; si++ {
		code := fmt.Sprintf("S%03d", si+1)
		id, err := s.seedSite(ctx, org, &cat, code, "Site "+code, apigen.SiteKindOffice, "")
		if err != nil {
			return out, err
		}
		sr := b.site(code, "Site "+code)
		sites[sr] = id
		ox, oy := float32(si%cols)*(siteW+120), float32(si/cols)*(siteH+120)
		b.frame(sr, "Site "+code, ox, oy, siteW, siteH)
		net := fmt.Sprintf("10.%d.%d", 20+si/250, si%250)
		r := b.device(seedDevice{site: sr, hostname: "R-" + code, catalogID: "cisco-isr4331", role: "edge", serialPrefix: "FDO", x: ox + siteW/2 - 72, y: oy + 50})
		b.mgmt(r, "GigabitEthernet0/0/1", "physical", net+".1/24")
		c1 := b.device(seedDevice{site: sr, hostname: "CORE1-" + code, catalogID: "cisco-c9300-48t", role: "core", serialPrefix: "FOC", x: ox + siteW/2 - 72 - nodeGapX, y: oy + 50 + nodeGapY})
		c2 := b.device(seedDevice{site: sr, hostname: "CORE2-" + code, catalogID: "cisco-c9300-48t", role: "core", serialPrefix: "FOC", x: ox + siteW/2 - 72 + nodeGapX, y: oy + 50 + nodeGapY})
		b.mgmt(c1, "Vlan1", "svi", net+".2/24")
		b.mgmt(c2, "Vlan1", "svi", net+".3/24")
		b.link(r, "GigabitEthernet0/0/1", c1, "GigabitEthernet1/0/48", "ethernet", ntbLink{})
		b.link(r, "GigabitEthernet0/0/2", c2, "GigabitEthernet1/0/48", "ethernet", ntbLink{})
		b.link(c1, "GigabitEthernet1/0/47", c2, "GigabitEthernet1/0/47", "ethernet", ntbLink{})
		made += 3
		for a := 0; a < benchSiteSize-3 && made < n; a++ {
			sw := b.device(seedDevice{site: sr, hostname: fmt.Sprintf("SW-%s-%02d", code, a+1), catalogID: "cisco-c1300-24t-4g", role: "access", serialPrefix: "DNI",
				x: ox + 40 + float32(a%perRow)*nodeGapX, y: oy + 50 + float32(2+a/perRow)*nodeGapY})
			b.mgmt(sw, "Vlan1", "svi", fmt.Sprintf("%s.%d/24", net, 10+a))
			b.link(c1, fmt.Sprintf("GigabitEthernet1/0/%d", a+1), sw, "GigabitEthernet1/0/23", "ethernet", ntbLink{})
			b.link(c2, fmt.Sprintf("GigabitEthernet1/0/%d", a+1), sw, "GigabitEthernet1/0/24", "ethernet", ntbLink{})
			made++
		}
	}
	res, err := s.seedImport(ctx, org, b, sites)
	if err != nil {
		return out, err
	}
	out.Devices, out.Links = res.Created.Devices, res.Created.Links
	out.Diagrams = []string{b.f.Diagram.Name}
	return out, nil
}
