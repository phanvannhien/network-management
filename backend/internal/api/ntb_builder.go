package api

import (
	"fmt"
	"regexp"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
)

// ntbBuilder writes a .ntb.json (ADR-037) in code: the sample data and benchmarks (P1-25) and the design templates
// (P2-23) are written through the same import as a file a user brings, so every rule applies.

type ntbBuilder struct {
	f      ntbFile
	seq    int
	ports  map[string]map[string]string // device ref → port name → interface ref
	order  map[string][]port            // device ref → its catalog ports in order (media, PoE)
	serial int
}

func newNtbBuilder(name, layer string) *ntbBuilder {
	return &ntbBuilder{
		f: ntbFile{SchemaVersion: "2.0.0", ExportedAt: "2026-10-17T00:00:00Z", Source: &ntbSource{App: "ntb seed"},
			Diagram: ntbDiagram{Name: name, Layer: layer, View: ntbView{Nodes: []ntbNode{}, Edges: []ntbEdge{}, Annotations: []ntbAnnotation{}}},
			Sites:   []ntbSite{}, Clusters: []ntbCluster{}, Devices: []ntbDevice{}, Interfaces: []ntbInterface{}, IPs: []ntbIP{},
			Subnets: []ntbSubnet{}, Ranges: []ntbRange{}, EndpointGroups: []ntbGroup{}, Links: []ntbLink{}},
		ports: map[string]map[string]string{},
		order: map[string][]port{},
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
	lifecycle                                     string // "" = active
	notes                                         string
}

// device adds a device with the catalog model's ports, placed at (x, y) on the diagram.
func (b *ntbBuilder) device(d seedDevice) string {
	r := b.ref("dev")
	dev := ntbDevice{Ref: r, SiteRef: d.site, Hostname: d.hostname, Type: d.typ, Role: d.role, Lifecycle: firstNonEmpty(d.lifecycle, "active"),
		Notes: d.notes}
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
		b.order[r] = ports
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

// setMgmt makes an interface of the device its management interface.
func (b *ntbBuilder) setMgmt(dev, ifRef string) {
	for i := range b.f.Devices {
		if b.f.Devices[i].Ref == dev {
			r := ifRef
			b.f.Devices[i].MgmtInterfaceRef = &r
		}
	}
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

// subif adds a VLAN sub-interface (802.1Q tag) on a port: "internal1.20" carrying VLAN 20.
func (b *ntbBuilder) subif(dev, parent string, vid int32) string {
	name := fmt.Sprintf("%s.%d", parent, vid)
	if r, ok := b.ports[dev][name]; ok {
		return r
	}
	r := b.ref("if")
	tag := vid
	b.f.Interfaces = append(b.f.Interfaces, ntbInterface{Ref: r, DeviceRef: dev, Name: name, Kind: "subinterface", VlanTag: &tag})
	b.ports[dev][name] = r
	return r
}

// subnet adds an IPAM subnet (and its range when start is valid) the file's groups can point at.
func (b *ntbBuilder) subnet(site string, cidr, gateway, start, end, kind, purpose string) (string, string) {
	sr := b.ref("sn")
	s := site
	b.f.Subnets = append(b.f.Subnets, ntbSubnet{Ref: sr, SiteRef: &s, Cidr: cidr, Gateway: gateway, Description: purpose})
	if start == "" {
		return sr, ""
	}
	rr := b.ref("rg")
	b.f.Ranges = append(b.f.Ranges, ntbRange{Ref: rr, SubnetRef: sr, StartIP: start, EndIP: end, Kind: kind, Purpose: purpose})
	return sr, rr
}

// groupIn adds an endpoint group bound to a range of the file ("" = none).
func (b *ntbBuilder) groupIn(site, kind, name, rangeRef, notes string, count int32, x, y float32) string {
	r := b.group(site, kind, name, count, x, y)
	g := &b.f.EndpointGroups[len(b.f.EndpointGroups)-1]
	g.Notes = notes
	if rangeRef != "" {
		rr := rangeRef
		g.RangeRef = &rr
	}
	return r
}

// logicalGroupLink draws a link without a port between a group and a device (remote-access VPN users).
func (b *ntbBuilder) logicalGroupLink(grp, dev string, opt ntbLink) {
	l := opt
	l.Ref, l.Kind, l.Status = b.ref("link"), "logical", "up"
	l.A, l.B = ntbEnd{Kind: "endpoint_group", Ref: grp}, ntbEnd{Kind: "device", Ref: dev}
	b.f.Links = append(b.f.Links, l)
	b.f.Diagram.View.Edges = append(b.f.Diagram.View.Edges, ntbEdge{ID: "e-" + l.Ref, LinkRef: l.Ref})
}

// oobPort: out-of-band management ports (Cisco Gi0/0, "mgmt"), never used for data cables.
var oobPort = regexp.MustCompile(`(?i)^(GigabitEthernet0/0|FastEthernet0|mgmt\d*)$`)

// portsWith lists a device's catalog data ports of a medium, in order.
func (b *ntbBuilder) portsWith(dev string, media ...string) []string {
	var out []string
	for _, p := range b.order[dev] {
		if oobPort.MatchString(p.name) {
			continue
		}
		for _, m := range media {
			if p.media == m {
				out = append(out, p.name)
				break
			}
		}
	}
	return out
}

// portsWithCatalog lists a catalog model's data ports of a medium (before any device of it exists).
func (b *ntbBuilder) portsWithCatalog(catalogID string, media ...string) []string {
	m, ok := catalog.Get(catalogID)
	if !ok {
		return nil
	}
	ports, _ := expandPorts(m.Ports, 1)
	var out []string
	for _, p := range ports {
		if oobPort.MatchString(p.name) {
			continue
		}
		for _, md := range media {
			if p.media == md {
				out = append(out, p.name)
				break
			}
		}
	}
	return out
}
