package api

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Reports (P2-11, SRS §12): read-only listings behind the Reports page and its Excel files. Every member sees the
// whole organization (ADR-032), so any member may read them; the scope is the topbar category and / or one site.
// No secret is part of any report.

type reportScope struct {
	site, category pgtype.UUID
}

func scopeOf(site *uuid.UUID, category *uuid.UUID) reportScope {
	var s reportScope
	if site != nil {
		s.site = pgUUID(*site)
	}
	if category != nil {
		s.category = pgUUID(*category)
	}
	return s
}

// dottedMask: 255.255.255.0 for an IPv4 prefix, "/64" for IPv6 (nobody writes IPv6 masks dotted).
func dottedMask(p netip.Prefix) string {
	if !p.Addr().Is4() {
		return "/" + strconv.Itoa(p.Bits())
	}
	return net.IP(net.CIDRMask(p.Bits(), 32)).String()
}

func (s *Server) GetIpPlanReport(ctx context.Context, req apigen.GetIpPlanReportRequestObject) (apigen.GetIpPlanReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc := scopeOf(req.Params.SiteId, req.Params.CategoryId)
	rows, err := s.q.ReportSubnets(ctx, store.ReportSubnetsParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report subnets: %w", err)
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	ranges, err := s.q.ReportRanges(ctx, store.ReportRangesParams{OrganizationID: m.OrgID, SubnetIds: ids})
	if err != nil {
		return nil, fmt.Errorf("report ranges: %w", err)
	}
	bySubnet := map[pgtype.UUID][]apigen.IpPlanRange{}
	for _, r := range ranges {
		bySubnet[r.SubnetID] = append(bySubnet[r.SubnetID], apigen.IpPlanRange{
			Kind: apigen.IpPlanRangeKind(r.Kind), StartIp: r.StartIp.String(), EndIp: r.EndIp.String(), Purpose: r.Purpose,
		})
	}
	out := apigen.IpPlanReport{Subnets: make([]apigen.IpPlanRow, 0, len(rows))}
	for _, r := range rows {
		gw := ""
		if r.Gateway != nil {
			gw = r.Gateway.String()
		}
		rr := bySubnet[r.ID]
		if rr == nil {
			rr = []apigen.IpPlanRange{}
		}
		out.Subnets = append(out.Subnets, apigen.IpPlanRow{
			Id: uuid.UUID(r.ID.Bytes), SiteCode: r.SiteCode, SiteName: r.SiteName, Cidr: r.Cidr.String(), Mask: dottedMask(r.Cidr),
			Vrf: r.Vrf, Gateway: gw, Description: r.Description, VlanVid: optInt(r.VlanVid), VlanName: r.VlanName,
			Size: hostCount(r.Cidr), Used: r.UsedCount, Ranges: rr,
		})
	}
	return apigen.GetIpPlanReport200JSONResponse(out), nil
}

// vlanListHas: whether an allowed-VLAN list ("10,20,30-39") names vid. An empty list means different things per
// vendor (all VLANs on Cisco, VLAN 1 on Huawei / H3C — GLOSSARY), so it names nothing here.
func vlanListHas(list string, vid int) bool {
	for _, part := range strings.Split(strings.ReplaceAll(list, " ", ""), ",") {
		lo, hi, isRange := strings.Cut(part, "-")
		a, err := strconv.Atoi(lo)
		if err != nil {
			continue
		}
		b := a
		if isRange {
			if b, err = strconv.Atoi(hi); err != nil {
				continue
			}
		}
		if vid >= a && vid <= b {
			return true
		}
	}
	return false
}

func (s *Server) GetVlanReport(ctx context.Context, req apigen.GetVlanReportRequestObject) (apigen.GetVlanReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc := scopeOf(req.Params.SiteId, req.Params.CategoryId)
	vlans, err := s.q.ReportVlans(ctx, store.ReportVlansParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report vlans: %w", err)
	}
	ports, err := s.q.ReportVlanPorts(ctx, store.ReportVlanPortsParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report vlan ports: %w", err)
	}
	// A site with its own VLAN 10 uses that one; the organization-wide VLAN 10 counts the other sites' ports.
	own := map[string]bool{}
	for _, v := range vlans {
		if v.SiteID.Valid {
			own[fmt.Sprintf("%s/%d", uuidStr(v.SiteID), v.Vid)] = true
		}
	}
	out := apigen.VlanReport{Vlans: make([]apigen.VlanReportRow, 0, len(vlans))}
	for _, v := range vlans {
		access, trunk := 0, 0
		for _, p := range ports {
			if v.SiteID.Valid && p.SiteID != v.SiteID {
				continue
			}
			if !v.SiteID.Valid && own[fmt.Sprintf("%s/%d", uuidStr(p.SiteID), v.Vid)] {
				continue
			}
			switch {
			case p.Mode == "access":
				if p.AccessVlan.Valid && p.AccessVlan.Int32 == v.Vid {
					access++
				}
			case (p.NativeVlan.Valid && p.NativeVlan.Int32 == v.Vid) || vlanListHas(p.AllowedVlans, int(v.Vid)):
				trunk++
			}
		}
		out.Vlans = append(out.Vlans, apigen.VlanReportRow{
			Id: uuid.UUID(v.ID.Bytes), Vid: v.Vid, Name: v.Name, Description: v.Description, SiteCode: v.SiteCode,
			Subnets: v.Subnets, Gateways: v.Gateways, AccessPorts: access, TrunkPorts: trunk,
		})
	}
	return apigen.GetVlanReport200JSONResponse(out), nil
}

func (s *Server) GetPortMapReport(ctx context.Context, req apigen.GetPortMapReportRequestObject) (apigen.GetPortMapReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc := scopeOf(req.Params.SiteId, req.Params.CategoryId)
	rows, err := s.q.ReportPorts(ctx, store.ReportPortsParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report ports: %w", err)
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	links, err := s.q.ReportPortLinks(ctx, store.ReportPortLinksParams{OrganizationID: m.OrgID, PortIds: ids})
	if err != nil {
		return nil, fmt.Errorf("report port links: %w", err)
	}
	// The far end of each cabled port.
	type far struct{ kind, name, port, cable, linkKind, status string }
	peer := map[pgtype.UUID]far{}
	for _, l := range links {
		if l.AInterfaceID.Valid {
			peer[l.AInterfaceID] = far{l.BKind, l.BName, l.BPort, l.CableID, l.Kind, l.Status}
		}
		if l.BInterfaceID.Valid {
			peer[l.BInterfaceID] = far{l.AKind, l.AName, l.APort, l.CableID, l.Kind, l.Status}
		}
	}
	out := apigen.PortMapReport{Devices: []apigen.PortMapDevice{}}
	for _, r := range rows {
		if n := len(out.Devices); n == 0 || out.Devices[n-1].Id != uuid.UUID(r.DeviceID.Bytes) {
			out.Devices = append(out.Devices, apigen.PortMapDevice{
				Id: uuid.UUID(r.DeviceID.Bytes), Hostname: r.Hostname, Type: apigen.DeviceType(r.Type), Vendor: r.Vendor,
				Model: r.Model, SiteCode: r.SiteCode, ClusterName: r.ClusterName, Ports: []apigen.PortMapPort{},
			})
		}
		d := &out.Devices[len(out.Devices)-1]
		f := peer[r.ID]
		d.Ports = append(d.Ports, apigen.PortMapPort{
			Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Kind: r.Kind, Description: r.Description, AdminUp: r.AdminUp,
			Mode: r.Mode, AccessVlan: optInt(r.AccessVlan), NativeVlan: optInt(r.NativeVlan), AllowedVlans: r.AllowedVlans,
			Speed: r.Speed, Duplex: r.Duplex, Media: r.Media, Poe: r.Poe, Lag: r.LagName,
			PeerKind: f.kind, PeerName: f.name, PeerPort: f.port, CableId: f.cable, LinkKind: f.linkKind, LinkStatus: f.status,
		})
	}
	return apigen.GetPortMapReport200JSONResponse(out), nil
}

func (s *Server) GetBoqReport(ctx context.Context, req apigen.GetBoqReportRequestObject) (apigen.GetBoqReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc := scopeOf(req.Params.SiteId, req.Params.CategoryId)
	rows, err := s.q.ReportBoq(ctx, store.ReportBoqParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report boq: %w", err)
	}
	// One line per status and item: the part number names the item; without one, vendor + model do. Planned, in use
	// and spare stay separate lines (a proposal and the as-built are never summed).
	out := apigen.BoqReport{Lines: []apigen.BoqLine{}}
	index := map[string]int{}
	for _, r := range rows {
		item := strings.ToLower(r.Vendor) + "\x00" + strings.ToLower(r.PartNumber)
		if r.PartNumber == "" {
			item = strings.ToLower(r.Vendor) + "\x00\x00" + strings.ToLower(r.Model) + "\x00" + r.Type
		}
		key := r.Lifecycle + "\x00" + item
		i, ok := index[key]
		if !ok {
			i = len(out.Lines)
			index[key] = i
			out.Lines = append(out.Lines, apigen.BoqLine{
				Lifecycle: apigen.BoqLineLifecycle(r.Lifecycle), Vendor: r.Vendor, Model: r.Model, PartNumber: r.PartNumber,
				Type: apigen.DeviceType(r.Type), Sites: []struct {
					Quantity int    `json:"quantity"`
					SiteCode string `json:"siteCode"`
				}{},
			})
		}
		l := &out.Lines[i]
		if l.Model == "" {
			l.Model = r.Model
		}
		l.Quantity += int(r.Quantity)
		l.Clustered += int(r.Clustered)
		l.Sites = append(l.Sites, struct {
			Quantity int    `json:"quantity"`
			SiteCode string `json:"siteCode"`
		}{int(r.Quantity), r.SiteCode})
	}
	return apigen.GetBoqReport200JSONResponse(out), nil
}
