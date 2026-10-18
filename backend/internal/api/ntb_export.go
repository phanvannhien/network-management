package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// ExportDiagramNtb writes the diagram and everything it uses as a .ntb.json file (P1-22, ADR-037). Built on the
// server so no secret can slip in (devices, ports, IPs, cables, groups, clusters, subnets, ranges, sites by code).
func (s *Server) ExportDiagramNtb(ctx context.Context, req apigen.ExportDiagramNtbRequestObject) (apigen.ExportDiagramNtbResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		file  ntbFile
		found bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var err error
		file, found, err = s.exportNtb(ctx, q, m, req.DiagramId)
		if err != nil || !found {
			return orRollback(err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "export.diagram_ntb",
			ObjectType: "diagram", ObjectID: req.DiagramId.String(),
			After: map[string]any{"name": file.Diagram.Name, "devices": len(file.Devices), "links": len(file.Links)},
			Meta:  infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if !found {
		return apigen.ExportDiagramNtb404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
	}
	raw, err := jsonMap(file)
	if err != nil {
		return nil, err
	}
	return apigen.ExportDiagramNtb200JSONResponse(raw), nil
}

func (s *Server) exportNtb(ctx context.Context, q store.Querier, m tenant.Membership, diagramID uuid.UUID) (ntbFile, bool, error) {
	f := ntbFile{SchemaVersion: ntbSchemaVersion, ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Source: &ntbSource{App: "Network Topology Builder", Version: s.version},
		Sites:  []ntbSite{}, Clusters: []ntbCluster{}, Devices: []ntbDevice{}, Interfaces: []ntbInterface{}, IPs: []ntbIP{},
		Subnets: []ntbSubnet{}, Ranges: []ntbRange{}, EndpointGroups: []ntbGroup{}, Links: []ntbLink{}}
	d, level, ok, err := loadDiagram(ctx, q, m, diagramID)
	if err != nil || !ok {
		return f, false, err
	}
	view, err := storedView(ctx, q, m, d.ID)
	if err != nil {
		return f, false, err
	}
	f.Diagram = ntbDiagram{Name: d.Name, Layer: d.Layer, Description: d.Description}

	sites := map[pgtype.UUID]bool{}
	clusters := map[pgtype.UUID]bool{}
	subnets := map[pgtype.UUID]bool{}
	ranges := map[pgtype.UUID]bool{}
	exported := map[uuid.UUID]bool{}
	for _, n := range view.Nodes {
		if exported[n.RefId] {
			continue
		}
		switch n.RefKind {
		case apigen.DiagramNodeRefKindDevice:
			dev, ok, err := loadDevice(ctx, q, m, n.RefId)
			if err != nil {
				return f, false, err
			}
			if !ok {
				continue // gone or out of reach: not exported
			}
			exported[n.RefId] = true
			sites[dev.SiteID] = true
			if dev.ClusterID.Valid {
				clusters[dev.ClusterID] = true
			}
			f.Devices = append(f.Devices, ntbDeviceOf(dev))
			ifs, err := q.ListInterfaces(ctx, store.ListInterfacesParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
			if err != nil {
				return f, false, fmt.Errorf("export interfaces: %w", err)
			}
			for _, i := range ifs {
				f.Interfaces = append(f.Interfaces, ntbInterfaceOf(i))
			}
			ips, err := q.ListDeviceIPs(ctx, store.ListDeviceIPsParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
			if err != nil {
				return f, false, fmt.Errorf("export ips: %w", err)
			}
			for _, ip := range ips {
				f.IPs = append(f.IPs, ntbIP{DeviceRef: uuidStr(dev.ID), InterfaceRef: refOf(ip.InterfaceID), Address: ip.Address.String(),
					Vrf: ip.Vrf, Role: ip.Role, Description: ip.Description})
				// The most specific subnet holding the address, for context on import.
				sns, err := q.LookupSubnets(ctx, store.LookupSubnetsParams{OrganizationID: m.OrgID, Ip: ip.Address.Addr()})
				if err != nil {
					return f, false, fmt.Errorf("export subnets: %w", err)
				}
				for _, sn := range sns {
					if sn.Vrf == ip.Vrf {
						if !subnets[sn.ID] {
							subnets[sn.ID] = true
							f.Subnets = append(f.Subnets, ntbSubnetOf(sn.SiteID, sn.ID, sn.Cidr, sn.Vrf, sn.Gateway, sn.Description))
							if sn.SiteID.Valid {
								sites[sn.SiteID] = true
							}
						}
						break
					}
				}
			}
		case apigen.DiagramNodeRefKindEndpointGroup:
			g, ok, err := loadGroup(ctx, q, m, n.RefId)
			if err != nil {
				return f, false, err
			}
			if !ok {
				continue
			}
			exported[n.RefId] = true
			sites[g.SiteID] = true
			ng := ntbGroup{Ref: uuidStr(g.ID), SiteRef: uuidStr(g.SiteID), Kind: g.Kind, Name: g.Name, Notes: g.Notes}
			if g.ExpectedCount.Valid {
				v := g.ExpectedCount.Int32
				ng.ExpectedCount = &v
			}
			if g.IpRangeID.Valid {
				r, err := q.GetRangeWithSubnet(ctx, store.GetRangeWithSubnetParams{ID: g.IpRangeID, OrganizationID: m.OrgID})
				if err != nil {
					return f, false, fmt.Errorf("export range: %w", err)
				}
				ng.RangeRef = refOf(r.ID)
				if !subnets[r.SubnetID] {
					subnets[r.SubnetID] = true
					f.Subnets = append(f.Subnets, ntbSubnetOf(r.SubnetSiteID, r.SubnetID, r.SubnetCidr, r.SubnetVrf, nil, ""))
					if r.SubnetSiteID.Valid {
						sites[r.SubnetSiteID] = true
					}
				}
				if !ranges[r.ID] {
					ranges[r.ID] = true
					f.Ranges = append(f.Ranges, ntbRange{Ref: uuidStr(r.ID), SubnetRef: uuidStr(r.SubnetID), StartIP: r.StartIp.String(),
						EndIP: r.EndIp.String(), Kind: r.Kind, Purpose: r.Purpose})
				}
			}
			f.EndpointGroups = append(f.EndpointGroups, ng)
		}
	}
	for id := range clusters {
		c, ok, err := loadCluster(ctx, q, m, uuid.UUID(id.Bytes))
		if err != nil {
			return f, false, err
		}
		if !ok {
			continue
		}
		nc := ntbCluster{Ref: uuidStr(c.ID), SiteRef: uuidStr(c.SiteID), Kind: c.Kind, Name: c.Name, Hostname: c.Hostname, Notes: c.Notes}
		if c.MgmtIp != nil {
			nc.MgmtIP = c.MgmtIp.String()
		}
		sites[c.SiteID] = true
		f.Clusters = append(f.Clusters, nc)
	}
	// Cables between exported objects (those on the view; the detail lists exactly these).
	detail, err := s.diagramDetail(ctx, q, m, d, level)
	if err != nil {
		return f, false, err
	}
	linked := map[uuid.UUID]bool{}
	for _, l := range detail.Links {
		if !exported[l.A.Id] || !exported[l.B.Id] {
			continue
		}
		linked[l.Id] = true
		f.Links = append(f.Links, ntbLink{Ref: l.Id.String(), Kind: string(l.Kind), A: ntbEndOf(l.A), B: ntbEndOf(l.B), Medium: l.Medium,
			Speed: l.Speed, LengthM: l.LengthM, CableID: l.CableId, Status: string(l.Status), FiberMode: string(l.FiberMode),
			Connector: string(l.Connector), Service: string(l.Service), Provider: l.Provider, CircuitID: l.CircuitId,
			Bandwidth: l.Bandwidth, Notes: l.Notes})
	}
	// The view, with refs to the file's objects (nodes of objects not exported are dropped).
	nv := ntbView{Nodes: []ntbNode{}, Edges: []ntbEdge{}, Annotations: []ntbAnnotation{}}
	for _, n := range view.Nodes {
		if !exported[n.RefId] {
			continue
		}
		nn := ntbNode{ID: n.Id, RefKind: string(n.RefKind), RefID: n.RefId.String(), X: n.X, Y: n.Y, Width: n.Width, Height: n.Height, Locked: n.Locked,
			PageID: str(n.PageId)}
		if n.LabelStyle != nil {
			nn.LabelStyle = *n.LabelStyle
		}
		nv.Nodes = append(nv.Nodes, nn)
	}
	for _, e := range view.Edges {
		if !linked[e.LinkId] {
			continue
		}
		ne := ntbEdge{ID: e.Id, LinkRef: e.LinkId.String(), PageID: str(e.PageId)}
		if e.Routing != nil {
			ne.Routing = string(*e.Routing)
		}
		for _, p := range ptrSlice(e.Waypoints) {
			ne.Waypoints = append(ne.Waypoints, ntbPoint{X: p.X, Y: p.Y})
		}
		nv.Edges = append(nv.Edges, ne)
	}
	for _, a := range view.Annotations {
		na := ntbAnnotation{ID: a.Id, Kind: string(a.Kind), X: a.X, Y: a.Y, Width: a.Width, Height: a.Height, Text: str(a.Text),
			Color: str(a.Color), FontSize: a.FontSize, PageID: str(a.PageId)}
		for _, p := range ptrSlice(a.Points) {
			na.Points = append(na.Points, ntbPoint{X: p.X, Y: p.Y})
		}
		if a.LineStyle != nil {
			na.LineStyle = string(*a.LineStyle)
		}
		if a.SiteId != nil {
			ref := a.SiteId.String()
			na.SiteRef = &ref
			sites[pgUUID(*a.SiteId)] = true
		}
		nv.Annotations = append(nv.Annotations, na)
	}
	if view.Viewport != nil {
		nv.Viewport = &ntbViewport{X: view.Viewport.X, Y: view.Viewport.Y, Zoom: view.Viewport.Zoom}
	}
	for _, p := range ptrSlice(view.Pages) {
		nv.Pages = append(nv.Pages, ntbPage{ID: p.Id, Name: p.Name, Layer: string(p.Layer)})
	}
	nv.LabelTemplate = str(view.LabelTemplate)
	if view.PortStyle != nil {
		nv.PortStyle = string(*view.PortStyle)
	}
	f.Diagram.View = nv
	for id := range sites {
		site, err := q.GetSite(ctx, store.GetSiteParams{ID: id, OrganizationID: m.OrgID})
		if err != nil {
			continue // a deleted site bound to a frame: the frame keeps its ref, unmapped on import
		}
		f.Sites = append(f.Sites, ntbSite{Ref: uuidStr(site.ID), Code: site.Code, Name: site.Name})
	}
	return f, true, nil
}

func refOf(id pgtype.UUID) *string {
	if !id.Valid {
		return nil
	}
	s := uuidStr(id)
	return &s
}

func ntbDeviceOf(d store.GetDeviceRow) ntbDevice {
	managed := d.Managed
	nd := ntbDevice{Ref: uuidStr(d.ID), SiteRef: uuidStr(d.SiteID), Hostname: d.Hostname, Type: d.Type, Vendor: d.Vendor, Model: d.Model,
		PartNumber: d.PartNumber, SerialNumber: d.SerialNumber, AssetTag: d.AssetTag, Firmware: d.Firmware, Role: d.Role,
		Lifecycle: d.Lifecycle, Managed: &managed, OwnerName: d.OwnerName, Notes: d.Notes, Tags: d.Tags, UHeight: d.UHeight,
		CatalogID: d.CatalogID, ClusterRef: refOf(d.ClusterID), MgmtInterfaceRef: refOf(d.MgmtInterfaceID)}
	if d.ClusterRole.Valid {
		r := d.ClusterRole.String
		nd.ClusterRole = &r
	}
	if d.ClusterMemberNo.Valid {
		n := d.ClusterMemberNo.Int32
		nd.ClusterMemberNo = &n
	}
	return nd
}

func ntbInterfaceOf(i store.ListInterfacesRow) ntbInterface {
	up := i.AdminUp
	ni := ntbInterface{Ref: uuidStr(i.ID), DeviceRef: uuidStr(i.DeviceID), Name: i.Name, Kind: i.Kind, Media: i.Media, Speed: i.Speed,
		Duplex: i.Duplex, Mode: i.Mode, AllowedVlans: i.AllowedVlans, Poe: i.Poe, LagRef: refOf(i.LagID), Description: i.Description,
		AdminUp: &up}
	if i.AccessVlan.Valid {
		v := i.AccessVlan.Int32
		ni.AccessVlan = &v
	}
	if i.NativeVlan.Valid {
		v := i.NativeVlan.Int32
		ni.NativeVlan = &v
	}
	if i.VlanTag.Valid {
		v := i.VlanTag.Int32
		ni.VlanTag = &v
	}
	if len(i.Mac) > 0 {
		mac := i.Mac.String()
		ni.MAC = &mac
	}
	return ni
}

func ntbSubnetOf(site, id pgtype.UUID, cidr netip.Prefix, vrf string, gw *netip.Addr, descr string) ntbSubnet {
	ns := ntbSubnet{Ref: uuidStr(id), SiteRef: refOf(site), Cidr: cidr.String(), Vrf: vrf, Description: descr}
	if gw != nil {
		ns.Gateway = gw.String()
	}
	return ns
}

func ntbEndOf(e apigen.LinkEnd) ntbEnd {
	ne := ntbEnd{Kind: string(e.Kind), Ref: e.Id.String()}
	if e.InterfaceId != nil {
		s := e.InterfaceId.String()
		ne.InterfaceRef = &s
	}
	return ne
}

// jsonMap: a value as the free-form JSON object the API returns for a file.
func jsonMap(v any) (map[string]interface{}, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("encode ntb: %w", err)
	}
	out := map[string]interface{}{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode ntb: %w", err)
	}
	return out, nil
}
