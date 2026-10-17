package api

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Design templates (P2-23, ADR-039): a ready network design for a small office, a medium office with a core, or a
// head office with branches — written as planned devices of real catalog models, endpoint groups, cables on real
// ports, VLANs / subnets / ranges in IPAM and a laid-out diagram. Everything goes through the .ntb.json import in one
// transaction, so every rule (unique IP / serial, one cable per port, audit) applies. Preview runs the same and rolls
// back.

// gatewayModel is a firewall / gateway with its ports by role.
type gatewayModel struct {
	catalog string
	wan     []string
	lan     []string
	ha      []string // heartbeat ports (two links), none = no HA
}

// vendorProfile: the models of one vendor stack, and where it routes between VLANs.
type vendorProfile struct {
	label              string
	ha                 bool // gateways run as an HA pair and cores as a stack
	routeOnCore        bool // medium office: VLAN gateways on the L3 core (else on the gateway, core switches only)
	small, medium      gatewayModel
	core               string // core / aggregation switch of a medium office
	access48, access24 string // PoE access switches
	ap                 string
	controller         string // Wi-Fi / switch controller to add ("" = built into the gateway)
}

func seq(prefix string, from, to int) []string {
	var out []string
	for n := from; n <= to; n++ {
		out = append(out, fmt.Sprintf("%s%d", prefix, n))
	}
	return out
}

var designProfiles = map[apigen.DesignRequestVendor]vendorProfile{
	apigen.FortinetCisco: {
		label: "Fortinet + Cisco", ha: true, routeOnCore: true,
		small:  gatewayModel{"fortinet-fortigate-60f", []string{"wan1", "wan2"}, seq("internal", 1, 5), []string{"a", "b"}},
		medium: gatewayModel{"fortinet-fortigate-100f", []string{"wan1", "wan2"}, seq("port", 1, 12), []string{"ha1", "ha2"}},
		core:   "cisco-c9200l-24t-4g", access48: "cisco-c1300-48p-4g", access24: "cisco-c1300-24p-4g", ap: "fortinet-fortiap-231f",
	},
	apigen.FortinetAruba: {
		label: "Fortinet + Aruba", ha: true, routeOnCore: true,
		small:  gatewayModel{"fortinet-fortigate-60f", []string{"wan1", "wan2"}, seq("internal", 1, 5), []string{"a", "b"}},
		medium: gatewayModel{"fortinet-fortigate-100f", []string{"wan1", "wan2"}, seq("port", 1, 12), []string{"ha1", "ha2"}},
		core:   "aruba-cx-6200f-24g-4sfpp", access48: "aruba-cx-6100-48g-poe-4sfpp", access24: "aruba-cx-6000-24g-poe-4sfp", ap: "aruba-ap-505",
	},
	apigen.TplinkOmada: {
		label:  "TP-Link Omada",
		small:  gatewayModel{"tp-link-er7206", []string{"Port 2", "Port 3"}, seq("Port ", 4, 6), nil},
		medium: gatewayModel{"tp-link-er8411", []string{"Port 4", "Port 5"}, seq("Port ", 6, 11), nil},
		core:   "tp-link-sg3428", access48: "tp-link-sg3452p", access24: "tp-link-sg3428mp", ap: "tp-link-eap650",
		controller: "tp-link-oc200",
	},
	apigen.Ubiquiti: {
		label:  "Ubiquiti UniFi",
		small:  gatewayModel{"ubiquiti-ucg-ultra", []string{"Port 5"}, seq("Port ", 1, 4), nil},
		medium: gatewayModel{"ubiquiti-udm-pro", []string{"Port 9"}, seq("Port ", 1, 8), nil},
		core:   "ubiquiti-usw-pro-24", access48: "ubiquiti-usw-pro-48-poe", access24: "ubiquiti-usw-pro-24-poe", ap: "ubiquiti-u6-pro",
	},
}

// Planned VLANs of a site (the usual SMB split; 10 = management).
const (
	vlanMgmt   = 10
	vlanStaff  = 20
	vlanVoice  = 30
	vlanCamera = 40
	vlanGuest  = 50
	vlanServer = 60
	// A switch is planned at 80 % of its endpoint ports: room to grow.
	usable48 = 38
	usable24 = 19
	// Above this many users a staff / voice VLAN gets a /23 (DHCP pool of ~450).
	bigVlanUsers = 180
)

// designSite is one site of the design.
type designSite struct {
	id         pgtype.UUID // existing or created
	ref        string      // in the file
	code, name string      // full site code, name
	prefix     string      // hostname prefix: the local code, or the full code when taken
	users      int
	medium     bool // core + access layer
	octet      int  // 10.<octet>.0.0/16 for this site
	vlans      map[int32]pgtype.UUID
	fw         string // primary gateway device ref
	x, y, w, h float32
}

type designer struct {
	req      apigen.DesignRequest
	p        vendorProfile
	b        *ntbBuilder
	sites    []*designSite
	prev     apigen.DesignPreview
	ipam     []designNet
	cur      map[string]int // access switch ref → next free endpoint port
	reserved map[string]int // access switch ref → endpoint ports kept at the end (downlinks to other switches)
}

// designNet is a subnet to create in IPAM before the import (same transaction), with its VLAN and range.
type designNet struct {
	site          *designSite
	vid           int32 // 0 = no VLAN
	name          string
	cidr          netip.Prefix
	gw            netip.Addr
	start, end    netip.Addr
	kind, purpose string
	rangeRef      string
	extra         []designRange // more ranges in the same subnet (printers in the staff VLAN)
}

type designRange struct {
	start, end    netip.Addr
	kind, purpose string
	ref           string
}

// note: advice for the engineer (not a problem of the design).
func (d *designer) note(format string, a ...any) {
	d.prev.Notes = append(d.prev.Notes, fmt.Sprintf(format, a...))
}

func (d *designer) warn(format string, a ...any) {
	d.prev.Warnings = append(d.prev.Warnings, fmt.Sprintf(format, a...))
}

func addr(octet, third, fourth int) netip.Addr {
	return netip.AddrFrom4([4]byte{10, byte(octet), byte(third), byte(fourth)})
}

// plan adds the subnet 10.<site>.<third>.0/<bits> with gateway .1 (VLAN subnets) and an optional range; the range
// ends are in the subnet's last /24 for a /23.
func (d *designer) plan(s *designSite, vid int32, third, bits int, name, kind string, from, to int) *designNet {
	n := designNet{site: s, vid: vid, name: name, cidr: netip.PrefixFrom(addr(s.octet, third, 0), bits), gw: addr(s.octet, third, 1),
		kind: kind, purpose: name}
	lastThird := third
	if bits == 23 {
		lastThird = third + 1
	}
	if kind != "" {
		n.start, n.end = addr(s.octet, third, from), addr(s.octet, lastThird, to)
	}
	gw := ""
	if vid != 0 {
		gw = n.gw.String()
	}
	start, end := "", ""
	if kind != "" {
		start, end = n.start.String(), n.end.String()
	}
	_, n.rangeRef = d.b.subnet(s.ref, n.cidr.String(), gw, start, end, kind, name)
	d.ipam = append(d.ipam, n)
	r := ""
	if kind != "" {
		r = fmt.Sprintf("%s – %s (%s)", n.start, n.end, rangeKindLabel[kind])
	}
	d.prev.Subnets = append(d.prev.Subnets, struct {
		Cidr    string `json:"cidr"`
		Dhcp    string `json:"dhcp"`
		Gateway string `json:"gateway"`
		Name    string `json:"name"`
		Site    string `json:"site"`
		Vlan    int    `json:"vlan"`
	}{Cidr: n.cidr.String(), Dhcp: r, Gateway: gw, Name: name, Site: s.name, Vlan: int(vid)})
	return &d.ipam[len(d.ipam)-1]
}

var rangeKindLabel = map[string]string{"dhcp": "DHCP", "static": "IP tĩnh", "reserved": "giữ chỗ"}

// addRange adds a second range to a planned subnet (e.g. static addresses for printers in the staff VLAN).
func (d *designer) addRange(n *designNet, from, to int, kind, purpose string) string {
	third := int(n.cidr.Addr().As4()[2])
	r := designRange{start: addr(n.site.octet, third, from), end: addr(n.site.octet, third, to), kind: kind, purpose: purpose}
	for i := range d.b.f.Subnets {
		if d.b.f.Subnets[i].Cidr == n.cidr.String() && d.b.f.Subnets[i].SiteRef != nil && *d.b.f.Subnets[i].SiteRef == n.site.ref {
			r.ref = d.b.ref("rg")
			d.b.f.Ranges = append(d.b.f.Ranges, ntbRange{Ref: r.ref, SubnetRef: d.b.f.Subnets[i].Ref, StartIP: r.start.String(),
				EndIP: r.end.String(), Kind: kind, Purpose: purpose})
		}
	}
	n.extra = append(n.extra, r)
	for i := range d.prev.Subnets {
		if d.prev.Subnets[i].Cidr == n.cidr.String() && d.prev.Subnets[i].Site == n.site.name {
			d.prev.Subnets[i].Dhcp += fmt.Sprintf("; %s – %s (%s, %s)", r.start, r.end, rangeKindLabel[kind], purpose)
		}
	}
	return r.ref
}

// dev adds a planned device and lists it in the preview.
func (d *designer) dev(s *designSite, role, name, catalogID, typ, cluster string, member int32, x, y float32) string {
	host := s.prefix + "-" + name
	r := d.b.device(seedDevice{site: s.ref, hostname: host, catalogID: catalogID, typ: typ, cluster: cluster, member: member, x: x, y: y,
		lifecycle: "planned", role: map[string]string{"firewall": "edge", "core": "core", "access": "access"}[role],
		notes: "Tạo từ sơ đồ mẫu — điền S/N khi lắp đặt rồi chuyển sang Đang dùng"})
	model, vendor := "", ""
	if m, ok := catalog.Get(catalogID); ok {
		model, vendor = m.Model, m.Vendor
	} else if typ == "ont" {
		model = "ONT nhà mạng"
	}
	if role != "internet" {
		d.prev.Devices = append(d.prev.Devices, struct {
			Hostname string `json:"hostname"`
			Model    string `json:"model"`
			Role     string `json:"role"`
			Site     string `json:"site"`
			Vendor   string `json:"vendor"`
		}{Hostname: host, Model: model, Role: role, Site: s.name, Vendor: vendor})
	}
	return r
}

func (d *designer) group(s *designSite, kind, name, rangeRef, notes string, count int, x, y float32) string {
	d.prev.Groups = append(d.prev.Groups, struct {
		Count int                 `json:"count"`
		Kind  apigen.EndpointKind `json:"kind"`
		Name  string              `json:"name"`
		Site  string              `json:"site"`
	}{Count: count, Kind: apigen.EndpointKind(kind), Name: name, Site: s.name})
	return d.b.groupIn(s.ref, kind, name, rangeRef, notes, int32(count), x, y)
}

// endpointPorts: the RJ45 ports of an access switch kept for endpoints — not its two uplinks, not the ports reserved
// at the end for downlinks to other switches.
func (d *designer) endpointPorts(sw string) []string {
	p := d.b.portsWith(sw, "RJ45")
	n := len(p) - 2 - d.reserved[sw]
	if n <= 0 {
		return nil
	}
	return p[:n]
}

func (d *designer) uplinks(sw string) []string {
	p := d.b.portsWith(sw, "RJ45")
	if len(p) < 2 {
		return p
	}
	return p[len(p)-2:]
}

// downlinks: ports at the end of the endpoint ports, kept for other switches hanging off this one.
func (d *designer) downlinks(sw string, n int) []string {
	p := d.b.portsWith(sw, "RJ45")
	end := len(p) - 2
	if end-n < 0 {
		return nil
	}
	d.reserved[sw] = n
	return p[end-n : end]
}

// take hands out the next free endpoint ports over the access switches, in order; short = fewer than asked.
func (d *designer) take(s *designSite, what string, switches []string, n int) [][2]string {
	var out [][2]string
	for _, sw := range switches {
		ports := d.endpointPorts(sw)
		for d.cur[sw] < len(ports) && len(out) < n {
			out = append(out, [2]string{sw, ports[d.cur[sw]]})
			d.cur[sw]++
		}
	}
	if len(out) < n {
		d.warn("%s: thiếu cổng switch — %s chỉ nối được %d/%d", s.name, what, len(out), n)
	}
	return out
}

// buildSite draws one site: Internet lines, gateway (HA pair), core (stack) for a medium site, access switches, APs,
// endpoint groups, VLANs / subnets.
func (d *designer) buildSite(s *designSite, withRemoteVPN bool) {
	b, p := d.b, d.p
	ha := designBool(d.req.Ha) && p.ha
	gw := p.small
	if s.medium {
		gw = p.medium
	}
	routeOnCore := s.medium && p.routeOnCore
	phones, cameras, guest := designBool(d.req.Phones), designBool(d.req.Cameras), designBool(d.req.GuestWifi)

	// Sizing.
	aps := max(1, int(math.Ceil(float64(s.users)/25)))
	if !s.medium {
		aps = max(2, aps)
	}
	cams := 0
	if cameras {
		cams = max(4, s.users/6)
	}
	printers := max(1, s.users/25)
	controller := 0
	if p.controller != "" {
		controller = 1
	}
	wired := s.users + cams + printers + aps + controller // PCs plug into the phone's PC port: one switch port per user
	model := p.access48
	switches := int(math.Ceil(float64(wired) / usable48))
	if wired <= usable24 {
		model, switches = p.access24, 1
	}
	if s.medium && switches+5 > len(d.b.portsWithCatalog(p.core, "RJ45")) {
		d.warn("%s: %d switch truy cập — nhiều hơn số cổng core %s nên chịu", s.name, switches, p.core)
	}

	// IP plan.
	bits := 24
	if s.users > bigVlanUsers {
		bits = 23
	}
	mgmt := d.plan(s, vlanMgmt, vlanMgmt, 24, "Quản trị thiết bị", "", 0, 0)
	staff := d.plan(s, vlanStaff, vlanStaff, bits, "Nhân viên", "dhcp", 50, 250)
	printersRange := d.addRange(staff, 11, 40, "static", "Máy in")
	var voice, camera, server, guestNet *designNet
	if phones {
		voice = d.plan(s, vlanVoice, vlanVoice, bits, "IP Phone", "dhcp", 50, 250)
	}
	if cameras {
		camera = d.plan(s, vlanCamera, vlanCamera, 24, "Camera", "static", 11, 200)
	}
	if guest {
		guestNet = d.plan(s, vlanGuest, vlanGuest, 24, "Wi-Fi khách", "dhcp", 50, 250)
	}
	if s.medium {
		server = d.plan(s, vlanServer, vlanServer, 24, "Server", "static", 10, 50)
	}
	_ = guestNet
	var vlans []int32
	for _, n := range d.ipam {
		if n.site == s && n.vid != 0 {
			vlans = append(vlans, n.vid)
		}
	}

	// Layout rows.
	rowY := func(r int) float32 { return s.y + 50 + float32(r)*nodeGapY }
	lines := 1
	if ha && len(gw.wan) > 1 {
		lines = 2
	}
	cols := max(switches, aps, 4, 2*lines+2)
	s.w = float32(cols)*nodeGapX + 120
	cx := s.x + s.w/2 - 72
	rows := 5
	if s.medium {
		rows = 6
	}
	s.h = float32(rows)*nodeGapY + 40
	b.frame(s.ref, s.name, s.x, s.y, s.w, s.h)

	// Gateway (HA pair).
	members := 1
	fwCluster := -1
	cluster := ""
	if ha {
		members = 2
		cluster = b.ref("cl")
		b.f.Clusters = append(b.f.Clusters, ntbCluster{Ref: cluster, SiteRef: s.ref, Kind: "ha_active_passive", Name: s.prefix + "-FW-HA",
			Hostname: s.prefix + "-FW"})
		fwCluster = len(b.f.Clusters) - 1
	}
	fws := make([]string, members)
	for m := range fws {
		x := cx + float32(m)*nodeGapX - float32(members-1)*nodeGapX/2
		fws[m] = d.dev(s, "firewall", fmt.Sprintf("FW%02d", m+1), gw.catalog, "", cluster, int32(m+1), x, rowY(1))
	}
	s.fw = fws[0]
	if ha {
		for _, hb := range gw.ha {
			b.link(fws[0], hb, fws[1], hb, "stack", ntbLink{Notes: "HA heartbeat"})
		}
	}

	// Internet: one line, a second ISP with HA (when the gateway has two WAN ports). Each line: the ISP cloud and its
	// ONT side by side on the top row.
	for l := 0; l < lines; l++ {
		x := s.x + 60 + float32(l)*2*nodeGapX
		isp := d.dev(s, "internet", fmt.Sprintf("INTERNET%d", l+1), "", "provider_cloud", "", 0, x, rowY(0))
		ont := d.dev(s, "ont", fmt.Sprintf("ONT%d", l+1), "", "ont", "", 0, x+nodeGapX, rowY(0))
		provider := fmt.Sprintf("Nhà mạng %d", l+1)
		b.link(isp, "", ont, "PON", "fiber", ntbLink{Service: "internet_broadband", Medium: "FTTH", Provider: provider})
		for m, fw := range fws {
			b.link(ont, fmt.Sprintf("LAN%d", m+1), fw, gw.wan[l], "ethernet", ntbLink{Medium: "Cat6"})
		}
	}
	if ha {
		d.note("%s: modem nhà mạng thường chỉ cho một cổng chạy PPPoE/bridge — cặp HA nên nối modem qua một switch WAN nhỏ hoặc VLAN WAN", s.name)
	}

	// VLAN gateways on the gateway: one trunk port (lan[0]) with a sub-interface per VLAN.
	gatewayVlans := func(vids []int32) {
		trunk := gw.lan[0]
		for _, vid := range vids {
			ir := b.subif(fws[0], trunk, vid)
			b.ip(fws[0], ir, netip.PrefixFrom(d.netOf(s, vid).gw, d.netOf(s, vid).cidr.Bits()).String(), fmt.Sprintf("Gateway VLAN %d", vid))
			if vid == vlanMgmt {
				b.setMgmt(fws[0], ir)
			}
		}
		if ha {
			b.f.Clusters[fwCluster].MgmtIP = netip.PrefixFrom(mgmt.gw, 24).String()
		}
	}

	accessRow := 2
	if s.medium {
		accessRow = 3
	}
	sws := make([]string, switches)
	for k := range sws {
		x := s.x + 60 + float32(k)*nodeGapX
		sws[k] = d.dev(s, "access", fmt.Sprintf("SW%02d", k+1), model, "", "", 0, x, rowY(accessRow))
		b.mgmt(sws[k], fmt.Sprintf("Vlan%d", vlanMgmt), "svi", netip.PrefixFrom(addr(s.octet, vlanMgmt, 11+k), 24).String())
	}

	if !s.medium {
		// Small office: every VLAN on the gateway's trunk to SW01; the other switches hang off SW01.
		gatewayVlans(vlans)
		ups := d.uplinks(sws[0])
		for m, fw := range fws {
			if m < len(ups) {
				b.link(fw, gw.lan[0], sws[0], ups[m], "ethernet", ntbLink{Medium: "Cat6", Notes: "Trunk các VLAN"})
			}
		}
		if switches > 1 {
			downs := d.downlinks(sws[0], switches-1)
			for k := 1; k < switches && k-1 < len(downs); k++ {
				b.link(sws[0], downs[k-1], sws[k], d.uplinks(sws[k])[0], "ethernet", ntbLink{Medium: "Cat6"})
			}
		}
	} else {
		coreCluster := ""
		cores := 1
		if ha {
			cores = 2
			coreCluster = b.ref("cl")
			b.f.Clusters = append(b.f.Clusters, ntbCluster{Ref: coreCluster, SiteRef: s.ref, Kind: "stack", Name: s.prefix + "-CORE",
				Hostname: s.prefix + "-CORE"})
		}
		cs := make([]string, cores)
		for m := range cs {
			x := cx + float32(m)*nodeGapX - float32(cores-1)*nodeGapX/2
			cs[m] = d.dev(s, "core", fmt.Sprintf("CORE%02d", m+1), p.core, "", coreCluster, int32(m+1), x, rowY(2))
		}
		if ha {
			a, z := b.portsWith(cs[0], "SFP", "SFP+"), b.portsWith(cs[1], "SFP", "SFP+")
			if len(a) > 0 && len(z) > 0 {
				b.link(cs[0], a[len(a)-1], cs[1], z[len(z)-1], "stack", ntbLink{Notes: "Stack (module stack chuyên dụng nếu dòng switch có)"})
			}
		}
		coreDown := make([][]string, cores) // RJ45 data ports of each core member, in order
		for m := range cs {
			coreDown[m] = b.portsWith(cs[m], "RJ45")
		}
		last := func(m, k int) string { return coreDown[m][len(coreDown[m])-1-k] }
		if routeOnCore {
			// Gateway ↔ core: a routed /30; VLAN gateways on the core, except guest Wi-Fi on the firewall (a trunk for
			// VLAN 50 on a second cable) so visitors never reach the inside.
			d.plan(s, 0, 255, 30, "Kết nối firewall – core", "", 0, 0)
			transitFW := netip.PrefixFrom(addr(s.octet, 255, 1), 30)
			transitCore := netip.PrefixFrom(addr(s.octet, 255, 2), 30)
			for m, fw := range fws {
				c := min(m, cores-1)
				b.link(fw, gw.lan[0], cs[c], last(c, 0), "ethernet", ntbLink{Medium: "Cat6", Notes: "Routed /30"})
				if guest {
					b.link(fw, gw.lan[1], cs[c], last(c, 1), "ethernet", ntbLink{Medium: "Cat6", Notes: "Trunk VLAN khách"})
				}
			}
			b.ip(fws[0], b.iface(fws[0], gw.lan[0], "physical"), transitFW.String(), "Kết nối core")
			b.setMgmt(fws[0], b.iface(fws[0], gw.lan[0], "physical"))
			b.ip(cs[0], b.iface(cs[0], last(0, 0), "physical"), transitCore.String(), "Kết nối firewall")
			if ha {
				b.f.Clusters[fwCluster].MgmtIP = transitFW.String()
			}
			for _, vid := range vlans {
				n := d.netOf(s, vid)
				if vid == vlanGuest {
					ir := b.subif(fws[0], gw.lan[1], vid)
					b.ip(fws[0], ir, netip.PrefixFrom(n.gw, n.cidr.Bits()).String(), "Gateway Wi-Fi khách")
					continue
				}
				ir := b.iface(cs[0], fmt.Sprintf("Vlan%d", vid), "svi")
				b.ip(cs[0], ir, netip.PrefixFrom(n.gw, n.cidr.Bits()).String(), fmt.Sprintf("Gateway VLAN %d", vid))
				if vid == vlanMgmt {
					b.setMgmt(cs[0], ir)
				}
			}
			d.note("%s: core định tuyến các VLAN — nhớ cấu hình DHCP relay (ip helper) trỏ về firewall hoặc DHCP server", s.name)
		} else {
			// TP-Link / UniFi: the gateway routes (router-on-a-stick), the core aggregates the access switches.
			gatewayVlans(vlans)
			for m, fw := range fws {
				c := min(m, cores-1)
				b.link(fw, gw.lan[0], cs[c], last(c, 0), "ethernet", ntbLink{Medium: "Cat6", Notes: "Trunk các VLAN"})
			}
			b.mgmt(cs[0], fmt.Sprintf("Vlan%d", vlanMgmt), "svi", netip.PrefixFrom(addr(s.octet, vlanMgmt, 2), 24).String())
		}
		// Access switches: one uplink to each core member (LACP pair with a stack).
		for k, sw := range sws {
			ups := d.uplinks(sw)
			for m := range cs {
				if k < len(coreDown[m])-3 && m < len(ups) {
					b.link(cs[m], coreDown[m][k], sw, ups[m], "ethernet", ntbLink{Medium: "Cat6"})
				}
			}
		}
		// Servers in the server room, on the core.
		srv := d.group(s, "server", "Server / NAS", server.rangeRef, "Phòng server, cắm thẳng vào core", 3, cx+nodeGapX*2, rowY(3))
		for k := 0; k < 3; k++ {
			b.groupLink(srv, cs[0], last(0, 2+k))
		}
	}

	// Controller (Omada) on SW01.
	if p.controller != "" {
		at := d.take(s, "bộ điều khiển", sws, 1)
		ctl := d.dev(s, "controller", "OC01", p.controller, "", "", 0, s.x+s.w-nodeGapX-40, rowY(accessRow))
		if len(at) == 1 {
			up := b.portsWith(ctl, "RJ45")
			b.link(at[0][0], at[0][1], ctl, up[0], "ethernet", ntbLink{Medium: "Cat6"})
			b.mgmt(ctl, up[0], "physical", netip.PrefixFrom(addr(s.octet, vlanMgmt, 5), 24).String())
		}
	}

	// Wi-Fi APs on PoE ports.
	for k, port := range d.take(s, "Wi-Fi AP", sws, aps) {
		x := s.x + 60 + float32(k)*nodeGapX
		ap := d.dev(s, "ap", fmt.Sprintf("AP%02d", k+1), p.ap, "", "", 0, x, rowY(accessRow+1))
		up := b.portsWith(ap, "RJ45")
		if len(up) == 0 {
			continue
		}
		b.link(port[0], port[1], ap, up[0], "ethernet", ntbLink{Medium: "Cat6"})
		b.mgmt(ap, up[0], "physical", netip.PrefixFrom(addr(s.octet, vlanMgmt, 51+k), 24).String())
	}

	// Endpoints as groups, one cable per switch port (ADR-036).
	gy := rowY(accessRow + 2)
	cable := func(g, what string, n int) {
		for _, port := range d.take(s, what, sws, n) {
			b.groupLink(g, port[0], port[1])
		}
	}
	if phones {
		ph := d.group(s, "ip_phone", "IP Phone", voice.rangeRef, "Máy tính cắm qua cổng PC của điện thoại", s.users, s.x+60, gy)
		cable(ph, "IP Phone", s.users)
		d.group(s, "pc", "Máy tính nhân viên", staff.rangeRef, "Cắm qua cổng PC của IP Phone", s.users, s.x+60+nodeGapX, gy)
	} else {
		pc := d.group(s, "pc", "Máy tính nhân viên", staff.rangeRef, "", s.users, s.x+60, gy)
		cable(pc, "máy tính", s.users)
	}
	if cameras {
		cam := d.group(s, "ip_camera", "Camera", camera.rangeRef, "Cần thêm đầu ghi (NVR) hoặc phần mềm ghi hình", cams, s.x+60+nodeGapX*2, gy)
		cable(cam, "camera", cams)
	}
	prn := d.group(s, "printer", "Máy in", printersRange, "IP tĩnh trong VLAN nhân viên", printers, s.x+60+nodeGapX*3, gy)
	cable(prn, "máy in", printers)

	// Staff working from outside: a client VPN pool on the gateway.
	if withRemoteVPN {
		pool := d.plan(s, 0, 250, 24, "VPN cho nhân viên ở xa", "dhcp", 100, 199)
		vpn := d.group(s, "laptop", "Nhân viên làm từ xa (VPN)", pool.rangeRef, "VPN client (SSL/IPsec) vào firewall",
			max(1, int(math.Ceil(float64(s.users)*0.3))), s.x+60+float32(2*lines)*nodeGapX+40, rowY(0))
		b.logicalGroupLink(vpn, fws[0], ntbLink{Medium: "VPN client"})
	}
}

func (d *designer) netOf(s *designSite, vid int32) *designNet {
	for i := range d.ipam {
		if d.ipam[i].site == s && d.ipam[i].vid == vid {
			return &d.ipam[i]
		}
	}
	return nil
}

// build lays the sites out and draws them; branches get a site-to-site VPN to the head office.
func (d *designer) build() {
	remote := designBool(d.req.RemoteVpn)
	x, y := float32(40), float32(40)
	for i, s := range d.sites {
		s.x, s.y = x, y
		d.buildSite(s, remote && i == 0)
		if i == 0 {
			x, y = 40, s.y+s.h+120
		} else {
			x += s.w + 80
		}
	}
	if len(d.sites) < 2 {
		return
	}
	hq := d.sites[0]
	d.plan(hq, 0, 254, 24, "VPN site-to-site", "", 0, 0)
	for i, br := range d.sites[1:] {
		hqT := d.b.iface(hq.fw, "VPN-"+br.prefix, "tunnel")
		brT := d.b.iface(br.fw, "VPN-"+hq.prefix, "tunnel")
		d.b.ip(hq.fw, hqT, netip.PrefixFrom(addr(hq.octet, 254, 4*i+1), 30).String(), "VPN "+br.name)
		d.b.ip(br.fw, brT, netip.PrefixFrom(addr(hq.octet, 254, 4*i+2), 30).String(), "VPN "+hq.name)
		d.b.f.Links = append(d.b.f.Links, ntbLink{Ref: d.b.ref("link"), Kind: "logical", Medium: "VPN/IPsec", Status: "up",
			Notes: "VPN site-to-site " + br.name + " ↔ " + hq.name,
			A:     ntbEnd{Kind: "device", Ref: br.fw, InterfaceRef: &brT}, B: ntbEnd{Kind: "device", Ref: hq.fw, InterfaceRef: &hqT}})
		last := d.b.f.Links[len(d.b.f.Links)-1]
		d.b.f.Diagram.View.Edges = append(d.b.f.Diagram.View.Edges, ntbEdge{ID: "e-" + last.Ref, LinkRef: last.Ref})
	}
}

// localCode: the last part of a full site code (ORG-CAT-HN01 → HN01).
func localCode(code string) string {
	if i := strings.LastIndex(code, "-"); i >= 0 {
		return code[i+1:]
	}
	return code
}

// --- request → sites → file → IPAM + import, in one transaction ---

func designBool(b *bool) bool { return b != nil && *b }

func checkDesign(r apigen.DesignRequest) (vendorProfile, string) {
	p, ok := designProfiles[r.Vendor]
	switch {
	case !ok || !r.Scenario.Valid():
		return p, "Kịch bản hoặc bộ hãng không hợp lệ"
	case r.Users < 5 || r.Users > 250:
		return p, "Số user từ 5 đến 250"
	case r.Scenario == apigen.Small && r.Users > 60:
		return p, "Văn phòng nhỏ tới 60 user — đông hơn thì chọn mẫu văn phòng vừa (có core switch)"
	case designBool(r.Ha) && !p.ha:
		return p, fmt.Sprintf("Bộ %s không có cặp firewall HA / core stack — chọn bộ Fortinet để dùng HA", p.label)
	case r.Scenario == apigen.Branches && (r.Branches == nil || *r.Branches < 1 || *r.Branches > 20):
		return p, "Số chi nhánh từ 1 đến 20"
	case r.Scenario == apigen.Branches && r.ExistingSiteId != nil:
		return p, "Mẫu nhiều chi nhánh luôn tạo site mới"
	case r.BranchUsers != nil && (*r.BranchUsers < 5 || *r.BranchUsers > 60):
		return p, "Số user mỗi chi nhánh từ 5 đến 60 (chi nhánh dùng mẫu văn phòng nhỏ)"
	case r.DiagramName != nil && tooLong(strings.TrimSpace(*r.DiagramName), 120):
		return p, "Tên sơ đồ tối đa 120 ký tự"
	}
	return p, ""
}

var scenarioNames = map[apigen.DesignRequestScenario]string{
	apigen.Small: "Văn phòng nhỏ", apigen.Medium: "Văn phòng vừa", apigen.Branches: "Trụ sở và chi nhánh",
}

// runDesign builds and writes the design inside tx. msg is a refusal to show (caller rolls back).
func (s *Server) runDesign(ctx context.Context, tx pgx.Tx, q store.Querier, m tenant.Membership, r apigen.DesignRequest) (*designer, apigen.NtbImportResult, string, error) {
	p, msg := checkDesign(r)
	if msg != "" {
		return nil, apigen.NtbImportResult{}, msg, nil
	}
	d := &designer{req: r, p: p, cur: map[string]int{}, reserved: map[string]int{}, prev: apigen.DesignPreview{Warnings: []string{}, Notes: []string{}}}
	name := scenarioNames[r.Scenario] + " — " + p.label
	if r.DiagramName != nil && strings.TrimSpace(*r.DiagramName) != "" {
		name = strings.TrimSpace(*r.DiagramName)
	}
	// Diagram names are unique in the organization: the default name takes a number, a typed one must be free.
	existing, err := q.ListDiagrams(ctx, store.ListDiagramsParams{OrganizationID: m.OrgID})
	if err != nil {
		return nil, apigen.NtbImportResult{}, "", fmt.Errorf("list diagrams: %w", err)
	}
	used := map[string]bool{}
	for _, dg := range existing {
		used[strings.ToLower(dg.Name)] = true
	}
	if used[strings.ToLower(name)] {
		if r.DiagramName != nil && strings.TrimSpace(*r.DiagramName) != "" {
			return nil, apigen.NtbImportResult{}, fmt.Sprintf("Đã có sơ đồ tên %s — đặt tên khác", name), nil
		}
		for n := 2; used[strings.ToLower(name)]; n++ {
			name = fmt.Sprintf("%s (%d)", scenarioNames[r.Scenario]+" — "+p.label, n)
		}
	}
	d.b = newNtbBuilder(name, "physical")

	// Sites: the existing one, or new ones (head office first).
	names := []string{}
	if r.SiteNames != nil {
		for _, n := range *r.SiteNames {
			names = append(names, strings.TrimSpace(n))
		}
	}
	nameAt := func(i int, def string) string {
		if i < len(names) && names[i] != "" {
			return names[i]
		}
		return def
	}
	type plannedSite struct {
		name, code string
		users      int
		medium     bool
	}
	var planned []plannedSite
	switch r.Scenario {
	case apigen.Small:
		planned = []plannedSite{{nameAt(0, "Văn phòng"), "VP", r.Users, false}}
	case apigen.Medium:
		planned = []plannedSite{{nameAt(0, "Văn phòng"), "VP", r.Users, true}}
	case apigen.Branches:
		bu := 50
		if r.BranchUsers != nil {
			bu = *r.BranchUsers
		}
		planned = []plannedSite{{nameAt(0, "Trụ sở"), "HQ", r.Users, r.Users > 50}}
		for i := 1; i <= *r.Branches; i++ {
			planned = append(planned, plannedSite{nameAt(i, fmt.Sprintf("Chi nhánh %02d", i)), fmt.Sprintf("CN%02d", i), bu, false})
		}
	}
	// One design at a time per organization: the free 10.x blocks are read, then written.
	if err := q.LockValue(ctx, uuidStr(m.OrgID)+"|design"); err != nil {
		return nil, apigen.NtbImportResult{}, "", fmt.Errorf("lock design: %w", err)
	}
	octet, err := freeOctets(ctx, q, m, len(planned))
	if err != nil {
		return nil, apigen.NtbImportResult{}, "", err
	}
	if octet < 0 {
		return nil, apigen.NtbImportResult{}, "IPAM không còn khối 10.x.0.0/16 trống cho mẫu này", nil
	}
	siteMap := map[string]uuid.UUID{}
	for i, ps := range planned {
		var site store.GetSiteRow
		if r.ExistingSiteId != nil {
			got, code, bad, err := writableSite(ctx, q, m, r.ExistingSiteId)
			if err != nil {
				return nil, apigen.NtbImportResult{}, "", err
			}
			if code != 0 || bad != "" {
				return nil, apigen.NtbImportResult{}, firstNonEmpty(bad, "Không ghi được vào site này"), nil
			}
			site = got
		} else {
			kind := apigen.SiteKindOffice
			var out writeOutcome
			for try := 0; ; try++ {
				code := ps.code
				if try > 0 {
					code = fmt.Sprintf("%s%d", ps.code, try+1)
				}
				f, bad := validateSite(code, ps.name, &kind, r.CategoryId, nil, nil, nil, nil, nil, nil, nil)
				if bad != "" {
					return nil, apigen.NtbImportResult{}, bad, nil
				}
				out = writeOutcome{}
				// Each attempt in a savepoint: a taken code is retried with the next number.
				sp, err := tx.Begin(ctx)
				if err != nil {
					return nil, apigen.NtbImportResult{}, "", fmt.Errorf("savepoint: %w", err)
				}
				site, err = writeNewSite(ctx, store.New(sp), m, f, &out)
				if err != nil && !errors.Is(err, errRollback) {
					_ = sp.Rollback(ctx)
					return nil, apigen.NtbImportResult{}, "", err
				}
				if errors.Is(err, errRollback) {
					_ = sp.Rollback(ctx)
					if out.conf != "" && try < 20 {
						continue
					}
					return nil, apigen.NtbImportResult{}, firstNonEmpty(out.bad, out.conf, msgCannotEdit), nil
				}
				if err := sp.Commit(ctx); err != nil {
					return nil, apigen.NtbImportResult{}, "", fmt.Errorf("release site: %w", err)
				}
				break
			}
		}
		ds := &designSite{id: site.ID, code: site.Code, name: site.Name, users: ps.users, medium: ps.medium, octet: octet + i, vlans: map[int32]pgtype.UUID{}}
		// Short hostnames (VP-FW01) unless another device already uses that prefix; then the full site code.
		ds.prefix = localCode(site.Code)
		if taken, err := q.HostnamePrefixTaken(ctx, store.HostnamePrefixTakenParams{OrganizationID: m.OrgID, Prefix: ds.prefix + "-"}); err != nil {
			return nil, apigen.NtbImportResult{}, "", fmt.Errorf("hostname prefix: %w", err)
		} else if taken {
			ds.prefix = site.Code
		}
		ds.ref = d.b.site(ds.code, ds.name)
		siteMap[ds.ref] = uuid.UUID(site.ID.Bytes)
		d.sites = append(d.sites, ds)
	}

	d.build()

	// IPAM first (VLANs, subnets, ranges): the import binds the groups to these ranges.
	for i := range d.ipam {
		n := &d.ipam[i]
		siteID := uuid.UUID(n.site.id.Bytes)
		var vlan *uuid.UUID
		if n.vid != 0 {
			id, ok := n.site.vlans[n.vid]
			if !ok {
				existing, err := q.ListVlans(ctx, store.ListVlansParams{OrganizationID: m.OrgID, SiteFilter: n.site.id})
				if err != nil {
					return nil, apigen.NtbImportResult{}, "", fmt.Errorf("site vlans: %w", err)
				}
				for _, v := range existing {
					if v.Vid == n.vid && v.SiteID == n.site.id {
						id, ok = v.ID, true
					}
				}
				if !ok {
					f, bad := validateVlan(n.vid, n.name, nil, nil, &siteID)
					if bad != "" {
						return nil, apigen.NtbImportResult{}, bad, nil
					}
					var out writeOutcome
					v, err := writeVlan(ctx, q, m, f, nil, 0, &out)
					if err != nil {
						if errors.Is(err, errRollback) {
							return nil, apigen.NtbImportResult{}, firstNonEmpty(out.bad, out.conf, msgCannotEdit), nil
						}
						return nil, apigen.NtbImportResult{}, "", err
					}
					id = v.ID
				}
				n.site.vlans[n.vid] = id
			}
			u := uuid.UUID(id.Bytes)
			vlan = &u
		}
		cidr := n.cidr.String()
		var gw *string
		if n.vid != 0 {
			g := n.gw.String()
			gw = &g
		}
		desc := n.purpose
		f, bad := validateSubnet(cidr, nil, gw, &desc, &siteID, vlan)
		if bad != "" {
			return nil, apigen.NtbImportResult{}, bad, nil
		}
		var out writeOutcome
		sn, err := writeSubnet(ctx, q, m, f, nil, 0, &out)
		if err != nil {
			if errors.Is(err, errRollback) {
				return nil, apigen.NtbImportResult{}, firstNonEmpty(out.bad, out.conf, msgCannotEdit), nil
			}
			return nil, apigen.NtbImportResult{}, "", err
		}
		ranges := []designRange{}
		if n.kind != "" {
			ranges = append(ranges, designRange{start: n.start, end: n.end, kind: n.kind, purpose: n.purpose})
		}
		for _, rg := range append(ranges, n.extra...) {
			purpose := rg.purpose
			if _, _, err := writeRange(ctx, q, m, uuid.UUID(sn.ID.Bytes), rg.start.String(), rg.end.String(), apigen.IpRangeKind(rg.kind), &purpose, &out); err != nil {
				if errors.Is(err, errRollback) {
					return nil, apigen.NtbImportResult{}, firstNonEmpty(out.bad, out.conf, msgCannotEdit), nil
				}
				return nil, apigen.NtbImportResult{}, "", err
			}
		}
	}

	sites := map[string]pgtype.UUID{}
	for ref, id := range siteMap {
		sites[ref] = pgUUID(id)
	}
	res, msg, err := importNtbTx(ctx, tx, m, apigen.NtbImport{DeviceActions: map[string]apigen.NtbImportDeviceActions{}}, d.b.f, sites, name)
	if err != nil || msg != "" {
		return d, res, msg, err
	}
	for _, w := range res.Warnings {
		d.warn("%s", w)
	}
	d.prev.Totals.Devices = len(d.prev.Devices)
	d.prev.Totals.Cables = len(d.b.f.Links)
	d.prev.Totals.Sites = len(d.sites)
	return d, res, "", audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "design_template.apply",
		ObjectType: "diagram", ObjectID: uuidStr(pgUUID(res.DiagramId)), After: map[string]any{"scenario": r.Scenario, "vendor": r.Vendor,
			"users": r.Users, "sites": len(d.sites), "devices": res.Created.Devices}, Meta: infoFrom(ctx).meta})
}

// freeOctets finds the first 10.N.0.0/16 such that N … N+count-1 hold no subnet of the organization (any VRF).
func freeOctets(ctx context.Context, q store.Querier, m tenant.Membership, count int) (int, error) {
	subnets, err := q.ListSubnets(ctx, store.ListSubnetsParams{OrganizationID: m.OrgID})
	if err != nil {
		return 0, fmt.Errorf("list subnets: %w", err)
	}
	taken := func(n int) bool {
		block := netip.PrefixFrom(netip.AddrFrom4([4]byte{10, byte(n), 0, 0}), 16)
		for _, sn := range subnets {
			if sn.Cidr.Overlaps(block) {
				return true
			}
		}
		return false
	}
	for start := 20; start+count <= 250; start++ {
		ok := true
		for n := start; n < start+count; n++ {
			if taken(n) {
				ok = false
				break
			}
		}
		if ok {
			return start, nil
		}
	}
	return -1, nil
}

func (s *Server) designTx(ctx context.Context, m tenant.Membership, r apigen.DesignRequest, commit bool) (*designer, apigen.NtbImportResult, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, apigen.NtbImportResult{}, "", fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	d, res, msg, err := s.runDesign(ctx, tx, store.New(tx), m, r)
	if err != nil || msg != "" || !commit {
		return d, res, msg, err
	}
	if err := tx.Commit(ctx); err != nil {
		return d, res, "", fmt.Errorf("commit design: %w", err)
	}
	return d, res, "", nil
}

// PreviewDesignTemplate runs the whole design in a transaction it rolls back: what would be created, nothing kept.
func (s *Server) PreviewDesignTemplate(ctx context.Context, req apigen.PreviewDesignTemplateRequestObject) (apigen.PreviewDesignTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.PreviewDesignTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	if req.Body == nil {
		return apigen.PreviewDesignTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	d, _, msg, err := s.designTx(ctx, m, *req.Body, false)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return apigen.PreviewDesignTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.PreviewDesignTemplate200JSONResponse(d.prev), nil
}

// ApplyDesignTemplate writes the design (P2-23): sites, IPAM, planned devices, groups, cables, the diagram.
func (s *Server) ApplyDesignTemplate(ctx context.Context, req apigen.ApplyDesignTemplateRequestObject) (apigen.ApplyDesignTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.ApplyDesignTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	if req.Body == nil {
		return apigen.ApplyDesignTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	d, res, msg, err := s.designTx(ctx, m, *req.Body, true)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return apigen.ApplyDesignTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.ApplyDesignTemplate201JSONResponse{DiagramId: res.DiagramId, Devices: res.Created.Devices, Cables: res.Created.Links,
		Sites: len(d.sites), Warnings: d.prev.Warnings}, nil
}
