package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

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

// reportScopeOf checks that the site / category asked for are the organization's (404 otherwise, like the dashboard).
func (s *Server) reportScopeOf(ctx context.Context, m tenant.Membership, site, category *uuid.UUID) (reportScope, string, error) {
	var sc reportScope
	if site != nil {
		sc.site = pgUUID(*site)
		if _, err := s.q.GetSite(ctx, store.GetSiteParams{ID: sc.site, OrganizationID: m.OrgID}); errors.Is(err, pgx.ErrNoRows) {
			return sc, "Không tìm thấy site", nil
		} else if err != nil {
			return sc, "", fmt.Errorf("report site: %w", err)
		}
	}
	if category != nil {
		sc.category = pgUUID(*category)
		if _, err := s.q.GetCategory(ctx, store.GetCategoryParams{ID: sc.category, OrganizationID: m.OrgID}); errors.Is(err, pgx.ErrNoRows) {
			return sc, "Không tìm thấy danh mục", nil
		} else if err != nil {
			return sc, "", fmt.Errorf("report category: %w", err)
		}
	}
	return sc, "", nil
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
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetIpPlanReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
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

// vlanSpans parses an allowed-VLAN list ("10,20,30-39") into ranges. An empty list means different things per vendor
// (all VLANs on Cisco, VLAN 1 on Huawei / H3C — GLOSSARY), so it names nothing here.
func vlanSpans(list string) [][2]int {
	var out [][2]int
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
		out = append(out, [2]int{a, b})
	}
	return out
}

// vlanListHas: whether an allowed-VLAN list names vid.
func vlanListHas(list string, vid int) bool {
	for _, sp := range vlanSpans(list) {
		if vid >= sp[0] && vid <= sp[1] {
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
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetVlanReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
	vlans, err := s.q.ReportVlans(ctx, store.ReportVlansParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report vlans: %w", err)
	}
	ports, err := s.q.ReportVlanPorts(ctx, store.ReportVlanPortsParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report vlan ports: %w", err)
	}
	// Ports grouped by site, each trunk's allowed list parsed once (an organization may have 100k ports).
	type trunk struct {
		native int32
		spans  [][2]int
	}
	type siteVid struct {
		site pgtype.UUID
		vid  int32
	}
	accessBy := map[siteVid]int{}
	trunks := map[pgtype.UUID][]trunk{}
	for _, p := range ports {
		if p.Mode == "access" {
			if p.AccessVlan.Valid {
				accessBy[siteVid{p.SiteID, p.AccessVlan.Int32}]++
			}
			continue
		}
		t := trunk{native: -1, spans: vlanSpans(p.AllowedVlans)}
		if p.NativeVlan.Valid {
			t.native = p.NativeVlan.Int32
		}
		trunks[p.SiteID] = append(trunks[p.SiteID], t)
	}
	carries := func(t trunk, vid int32) bool {
		if t.native == vid {
			return true
		}
		for _, sp := range t.spans {
			if int(vid) >= sp[0] && int(vid) <= sp[1] {
				return true
			}
		}
		return false
	}
	// A site with its own VLAN 10 uses that one; the organization-wide VLAN 10 counts the other sites' ports.
	own := map[siteVid]bool{}
	for _, v := range vlans {
		if v.SiteID.Valid {
			own[siteVid{v.SiteID, v.Vid}] = true
		}
	}
	out := apigen.VlanReport{Vlans: make([]apigen.VlanReportRow, 0, len(vlans))}
	for _, v := range vlans {
		access, trunkCount := 0, 0
		count := func(site pgtype.UUID) {
			access += accessBy[siteVid{site, v.Vid}]
			for _, t := range trunks[site] {
				if carries(t, v.Vid) {
					trunkCount++
				}
			}
		}
		if v.SiteID.Valid {
			count(v.SiteID)
		} else {
			sites := map[pgtype.UUID]bool{}
			for k := range accessBy {
				sites[k.site] = true
			}
			for site := range trunks {
				sites[site] = true
			}
			for site := range sites {
				if !own[siteVid{site, v.Vid}] {
					count(site)
				}
			}
		}
		out.Vlans = append(out.Vlans, apigen.VlanReportRow{
			Id: uuid.UUID(v.ID.Bytes), Vid: v.Vid, Name: v.Name, Description: v.Description, SiteCode: v.SiteCode,
			Subnets: v.Subnets, Gateways: v.Gateways, AccessPorts: access, TrunkPorts: trunkCount,
		})
	}
	return apigen.GetVlanReport200JSONResponse(out), nil
}

func (s *Server) GetPortMapReport(ctx context.Context, req apigen.GetPortMapReportRequestObject) (apigen.GetPortMapReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetPortMapReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
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
	// The far end of each cabled port. A cable wins over a logical link on the same port (a VPN bound to the WAN port
	// is not what is plugged in); several cables (a PON port's ONTs) are listed together.
	type far struct{ kind, name, port, cable, linkKind, status string }
	peer := map[pgtype.UUID]far{}
	add := func(port pgtype.UUID, f far) {
		cur, ok := peer[port]
		switch {
		case !ok || (cur.linkKind == "logical" && f.linkKind != "logical"):
			peer[port] = f
		case f.linkKind == "logical" || cur.linkKind == "logical":
		default:
			cur.name += ", " + f.name
			if f.port != "" {
				cur.port = strings.TrimPrefix(cur.port+", "+f.port, ", ")
			}
			if f.cable != "" {
				cur.cable = strings.TrimPrefix(cur.cable+", "+f.cable, ", ")
			}
			peer[port] = cur
		}
	}
	for _, l := range links {
		if l.AInterfaceID.Valid {
			add(l.AInterfaceID, far{l.BKind, l.BName, l.BPort, l.CableID, l.Kind, l.Status})
		}
		if l.BInterfaceID.Valid {
			add(l.BInterfaceID, far{l.AKind, l.AName, l.APort, l.CableID, l.Kind, l.Status})
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
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetBoqReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
	rows, err := s.q.ReportBoq(ctx, store.ReportBoqParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report boq: %w", err)
	}
	// One line per status and item: the part number names the item; without one, vendor + model do. Planned, in use
	// and spare stay separate lines (a proposal and the as-built are never summed).
	out := apigen.BoqReport{Lines: []apigen.BoqLine{}}
	index := map[string]int{}
	for _, r := range rows {
		norm := func(v string) string { return strings.ToLower(strings.TrimSpace(v)) }
		item := norm(r.Vendor) + "\x00" + norm(r.PartNumber)
		if norm(r.PartNumber) == "" {
			item = norm(r.Vendor) + "\x00\x00" + norm(r.Model) + "\x00" + r.Type
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
		// Rows of one item can differ in model spelling: add up per site.
		merged := false
		for k := range l.Sites {
			if l.Sites[k].SiteCode == r.SiteCode {
				l.Sites[k].Quantity += int(r.Quantity)
				merged = true
			}
		}
		if !merged {
			l.Sites = append(l.Sites, struct {
				Quantity int    `json:"quantity"`
				SiteCode string `json:"siteCode"`
			}{int(r.Quantity), r.SiteCode})
		}
	}
	return apigen.GetBoqReport200JSONResponse(out), nil
}

// reportDays: the expiry window (default 90 days, at most a year).
func reportDays(d *int) int {
	if d == nil || *d < 1 {
		return 90
	}
	return min(*d, 365)
}

func (s *Server) GetExpiringReport(ctx context.Context, req apigen.GetExpiringReportRequestObject) (apigen.GetExpiringReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetExpiringReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
	today := calendarToday()
	until := pgtype.Date{Time: today.AddDate(0, 0, reportDays(req.Params.Days)), Valid: true}
	days := func(d time.Time) int { return int(d.Sub(today).Hours() / 24) }
	rows, err := s.q.ReportExpiring(ctx, store.ReportExpiringParams{OrganizationID: m.OrgID, Until: until, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report expiring: %w", err)
	}
	out := apigen.ExpiringReport{Today: openapi_types.Date{Time: today}, Items: []apigen.ExpiringItem{}}
	for _, r := range rows {
		out.Items = append(out.Items, apigen.ExpiringItem{
			Kind: apigen.ExpiringItemKind(r.Kind), SubjectId: uuid.UUID(r.ID.Bytes), Subject: r.Hostname,
			Detail: strings.TrimSpace(r.Vendor + " " + r.Model), SiteCode: r.SiteCode, Lifecycle: r.Lifecycle, Muted: r.AlertsMuted,
			Vendor: r.Supplier, Date: openapi_types.Date{Time: r.Day.Time}, Days: days(r.Day.Time),
		})
	}
	// Contracts belong to the organization: listed whatever the site / category, ended up to a year ago.
	contracts, err := s.q.ReportExpiringContracts(ctx, store.ReportExpiringContractsParams{
		OrganizationID: m.OrgID, Since: pgtype.Date{Time: today.AddDate(-1, 0, 0), Valid: true}, Until: until,
	})
	if err != nil {
		return nil, fmt.Errorf("report expiring contracts: %w", err)
	}
	for _, k := range contracts {
		out.Items = append(out.Items, apigen.ExpiringItem{
			Kind: apigen.ExpiringItemKindContract, SubjectId: uuid.UUID(k.ID.Bytes), Subject: k.Name, Detail: k.Number,
			Vendor: k.VendorName, Date: openapi_types.Date{Time: k.Day.Time}, Days: days(k.Day.Time),
		})
	}
	slices.SortStableFunc(out.Items, func(a, b apigen.ExpiringItem) int { return a.Date.Compare(b.Date.Time) })
	return apigen.GetExpiringReport200JSONResponse(out), nil
}

func (s *Server) GetMissingInfoReport(ctx context.Context, req apigen.GetMissingInfoReportRequestObject) (apigen.GetMissingInfoReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetMissingInfoReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
	// The dashboard's query without its limit: one definition (ADR-052).
	rows, err := s.q.DashboardMissingInfo(ctx, store.DashboardMissingInfoParams{OrganizationID: m.OrgID, CategoryFilter: sc.category, SiteFilter: sc.site})
	if err != nil {
		return nil, fmt.Errorf("report missing info: %w", err)
	}
	out := apigen.MissingInfoReport{Devices: make([]apigen.MissingInfoRow, 0, len(rows))}
	for _, r := range rows {
		what := []apigen.MissingInfoRowMissing{}
		for _, f := range missingFields(r) {
			what = append(what, apigen.MissingInfoRowMissing(f))
		}
		out.Devices = append(out.Devices, apigen.MissingInfoRow{
			Id: uuid.UUID(r.ID.Bytes), Hostname: r.Hostname, Type: apigen.DeviceType(r.Type), Vendor: r.Vendor, Model: r.Model,
			SiteCode: r.SiteCode, Missing: what,
		})
	}
	return apigen.GetMissingInfoReport200JSONResponse(out), nil
}

func (s *Server) GetInventoryReport(ctx context.Context, req apigen.GetInventoryReportRequestObject) (apigen.GetInventoryReportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sc, missing, err := s.reportScopeOf(ctx, m, req.Params.SiteId, req.Params.CategoryId)
	if err != nil {
		return nil, err
	}
	if missing != "" {
		return apigen.GetInventoryReport404JSONResponse{NotFoundJSONResponse: notFoundBody(missing)}, nil
	}
	rows, err := s.q.ReportInventory(ctx, store.ReportInventoryParams{OrganizationID: m.OrgID, SiteFilter: sc.site, CategoryFilter: sc.category})
	if err != nil {
		return nil, fmt.Errorf("report inventory: %w", err)
	}
	out := apigen.InventoryReport{Rows: make([]apigen.InventoryRow, 0, len(rows))}
	for _, r := range rows {
		out.Rows = append(out.Rows, apigen.InventoryRow{
			SiteCode: r.SiteCode, SiteName: r.SiteName, Type: apigen.DeviceType(r.Type), Vendor: r.Vendor,
			Lifecycle: apigen.InventoryRowLifecycle(r.Lifecycle), Quantity: int(r.Quantity),
		})
	}
	return apigen.GetInventoryReport200JSONResponse(out), nil
}
