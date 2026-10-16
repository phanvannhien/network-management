package api

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/netip"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// IPAM basics (P1-10, SRS §5, ADR-014). VLANs and subnets belong to a site (or the whole organization when site-less);
// access follows the site (ADR-031) and site-less objects need an organization-wide role. Usage is computed from
// interface IPs of every device (same VRF) so planning never hands out an address in use, while the list of addresses
// only shows devices the caller may see.

const (
	msgVlanNotFound   = "Không tìm thấy VLAN"
	msgSubnetNotFound = "Không tìm thấy subnet"
	msgRangeNotFound  = "Không tìm thấy dải IP"
	nextFreeScanLimit = 1 << 16 // IPv6 subnets are huge: only the first addresses are scanned
)

var colorRe = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// --- access ---

// scopeLevel is the caller's level on a site-scoped object: the site's level, or the organization role when site-less.
func scopeLevel(ctx context.Context, q store.Querier, m tenant.Membership, site, siteUnit, sitePartner pgtype.UUID) (int, error) {
	if !site.Valid {
		return m.UnitLevel(pgtype.UUID{}, pgtype.UUID{}), nil // organization role only
	}
	levels, err := siteLevels(ctx, q, m, []siteRef{{site, siteUnit, sitePartner}})
	if err != nil {
		return 0, err
	}
	return levels[site], nil
}

// writableSite checks the caller may put an object in this site (nil = organization-wide). Returns 400 / 403 codes.
func writableSite(ctx context.Context, q store.Querier, m tenant.Membership, site *uuid.UUID) (store.GetSiteRow, int, string, error) {
	if site == nil {
		if !m.CanEdit() {
			return store.GetSiteRow{}, 403, "", nil
		}
		return store.GetSiteRow{}, 0, "", nil
	}
	s, ok, err := loadSite(ctx, q, m, *site)
	if err != nil {
		return s, 0, "", err
	}
	if !ok {
		return s, 400, "Site không tồn tại trong tổ chức", nil
	}
	level, err := siteLevel(ctx, q, m, s)
	if err != nil {
		return s, 0, "", err
	}
	if level < tenant.LevelEdit {
		return s, 403, "", nil
	}
	return s, 0, "", nil
}

func visParams(m tenant.Membership) (bool, []pgtype.UUID, []pgtype.UUID, []pgtype.UUID) {
	v := visibilityOf(m)
	return v.restricted, v.grantUnits, v.grantPartners, v.sharePts
}

// --- address maths ---

// hostCount is the number of usable host addresses of a prefix (IPv4 /30 → 2, /31 and /32 → all); huge IPv6
// prefixes are capped at MaxInt64.
func hostCount(p netip.Prefix) int64 {
	free := p.Addr().BitLen() - p.Bits()
	if free >= 63 {
		return math.MaxInt64
	}
	n := int64(1) << free
	if p.Addr().Is4() && p.Bits() < 31 {
		n -= 2
	}
	return n
}

func rangeSize(a, b netip.Addr) int64 {
	x, y := new(big.Int).SetBytes(a.AsSlice()), new(big.Int).SetBytes(b.AsSlice())
	d := new(big.Int).Sub(y, x)
	d.Add(d, big.NewInt(1))
	if !d.IsInt64() {
		return math.MaxInt64
	}
	return d.Int64()
}

// broadcast is the last address of an IPv4 prefix.
func lastAddr(p netip.Prefix) netip.Addr {
	b := p.Masked().Addr().AsSlice()
	free := p.Addr().BitLen() - p.Bits()
	for i := len(b) - 1; i >= 0 && free > 0; i-- {
		bits := min(free, 8)
		b[i] |= byte(1<<bits - 1)
		free -= bits
	}
	a, _ := netip.AddrFromSlice(b)
	return a
}

// usableBounds is the first and last assignable host (IPv4 skips network and broadcast below /31).
func usableBounds(p netip.Prefix) (netip.Addr, netip.Addr) {
	first, last := p.Masked().Addr(), lastAddr(p)
	if p.Addr().Is4() && p.Bits() < 31 {
		first, last = first.Next(), last.Prev()
	}
	return first, last
}

func inRange(a, start, end netip.Addr) bool { return a.Compare(start) >= 0 && a.Compare(end) <= 0 }

// --- VLANs ---

func toVlan(v store.GetVlanRow, level int) apigen.Vlan {
	return apigen.Vlan{
		Id: uuid.UUID(v.ID.Bytes), SiteId: optUUID(v.SiteID), SiteCode: v.SiteCode, Vid: v.Vid, Name: v.Name, Color: v.Color,
		Description: v.Description, SubnetCount: v.SubnetCount, Access: levelName(level), Version: v.Version,
	}
}

func loadVlan(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetVlanRow, bool, error) {
	r, u, p, sp := visParams(m)
	v, err := q.GetVlan(ctx, store.GetVlanParams{ID: pgUUID(id), OrganizationID: m.OrgID, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp})
	if errors.Is(err, pgx.ErrNoRows) {
		return v, false, nil
	}
	if err != nil {
		return v, false, fmt.Errorf("load vlan: %w", err)
	}
	return v, true, nil
}

type vlanFields struct {
	vid                      int32
	name, color, description string
	site                     *uuid.UUID
}

func validateVlan(vid int32, name string, color, description *string, site *uuid.UUID) (vlanFields, string) {
	f := vlanFields{vid: vid, name: strings.TrimSpace(name), color: "#64748b", description: str(description), site: site}
	if color != nil && *color != "" {
		f.color = strings.ToLower(*color)
	}
	switch {
	case vid < 1 || vid > 4094:
		return f, "Số VLAN từ 1 đến 4094"
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên VLAN bắt buộc, tối đa 100 ký tự"
	case !colorRe.MatchString(f.color):
		return f, "Màu dạng #rrggbb"
	case tooLong(f.description, 500):
		return f, "Mô tả tối đa 500 ký tự"
	}
	return f, ""
}

type vlanSnapshot struct {
	Site  string `json:"site,omitempty"`
	Vid   int32  `json:"vid"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

func vlanLevel(ctx context.Context, q store.Querier, m tenant.Membership, v store.GetVlanRow) (int, error) {
	return scopeLevel(ctx, q, m, v.SiteID, v.SiteUnitID, v.SitePartnerID)
}

func (s *Server) ListVlans(ctx context.Context, req apigen.ListVlansRequestObject) (apigen.ListVlansResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	r, u, p, sp := visParams(m)
	params := store.ListVlansParams{OrganizationID: m.OrgID, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp}
	if req.Params.SiteId != nil {
		params.SiteFilter = pgUUID(*req.Params.SiteId)
	}
	rows, err := s.q.ListVlans(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list vlans: %w", err)
	}
	out := apigen.VlanList{Vlans: make([]apigen.Vlan, 0, len(rows))}
	for _, row := range rows {
		v := store.GetVlanRow(row)
		level, err := vlanLevel(ctx, s.q, m, v)
		if err != nil {
			return nil, err
		}
		out.Vlans = append(out.Vlans, toVlan(v, level))
	}
	return apigen.ListVlans200JSONResponse(out), nil
}

// saveVlan creates (id nil) or updates a VLAN; codes as writeOutcome.
func (s *Server) saveVlan(ctx context.Context, m tenant.Membership, f vlanFields, id *uuid.UUID, version int32) (store.GetVlanRow, writeOutcome, error) {
	var (
		out   writeOutcome
		saved store.GetVlanRow
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		var before store.GetVlanRow
		if id != nil {
			var ok bool
			var err error
			if before, ok, err = loadVlan(ctx, q, m, *id); err != nil {
				return err
			}
			if !ok {
				out.gone = true
				return errRollback
			}
			if level, err := vlanLevel(ctx, q, m, before); err != nil {
				return err
			} else if level < tenant.LevelEdit {
				out.code = 403
				return errRollback
			}
		}
		_, code, bad, err := writableSite(ctx, q, m, f.site)
		if err != nil || code != 0 {
			out.code, out.bad = code, bad
			return orRollback(err)
		}
		var vid pgtype.UUID
		siteID := pgtype.UUID{}
		if f.site != nil {
			siteID = pgUUID(*f.site)
		}
		// Moving a VLAN into one site must not strand subnets of other sites that use it.
		if id != nil && siteID.Valid && siteID != before.SiteID {
			used, err := q.ListSubnets(ctx, store.ListSubnetsParams{OrganizationID: m.OrgID, VlanFilter: before.ID})
			if err != nil {
				return fmt.Errorf("vlan subnets: %w", err)
			}
			for _, sn := range used {
				if sn.SiteID != siteID {
					out.bad = fmt.Sprintf("Subnet %s (site khác) đang dùng VLAN này", sn.Cidr)
					return errRollback
				}
			}
		}
		if id == nil {
			vid, err = q.CreateVlan(ctx, store.CreateVlanParams{OrganizationID: m.OrgID, SiteID: siteID, Vid: f.vid, Name: f.name, Color: f.color, Description: f.description})
		} else {
			vid = before.ID
			var n int64
			n, err = q.UpdateVlan(ctx, store.UpdateVlanParams{ID: before.ID, OrganizationID: m.OrgID, Version: version, SiteID: siteID, Vid: f.vid, Name: f.name, Color: f.color, Description: f.description})
			if err == nil && n == 0 {
				out.conf = msgStale
				return errRollback
			}
		}
		if isUniqueViolation(err) {
			out.conf = fmt.Sprintf("VLAN %d đã có ở phạm vi này", f.vid)
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save vlan: %w", err)
		}
		var ok bool
		if saved, ok, err = loadVlan(ctx, q, m, uuid.UUID(vid.Bytes)); err != nil || !ok {
			out.code = 403
			return orRollback(err)
		}
		entry := audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vlan.create", ObjectType: "vlan", ObjectID: uuidStr(vid),
			After: vlanSnapshot{saved.SiteCode, saved.Vid, saved.Name, saved.Color}, Meta: infoFrom(ctx).meta}
		if id != nil {
			entry.Action, entry.Before = "vlan.update", vlanSnapshot{before.SiteCode, before.Vid, before.Name, before.Color}
		}
		return audit.Write(ctx, q, entry)
	})
	return saved, out, err
}

func (s *Server) CreateVlan(ctx context.Context, req apigen.CreateVlanRequestObject) (apigen.CreateVlanResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateVlan(b.Vid, b.Name, b.Color, b.Description, b.SiteId)
	if msg != "" {
		return apigen.CreateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	v, out, err := s.saveVlan(ctx, m, f, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.CreateVlan403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.CreateVlan409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	level, err := vlanLevel(ctx, s.q, m, v)
	if err != nil {
		return nil, err
	}
	return apigen.CreateVlan201JSONResponse(toVlan(v, level)), nil
}

func (s *Server) UpdateVlan(ctx context.Context, req apigen.UpdateVlanRequestObject) (apigen.UpdateVlanResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	if _, ok, err := loadVlan(ctx, s.q, m, req.VlanId); err != nil {
		return nil, err
	} else if !ok {
		return apigen.UpdateVlan404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVlanNotFound)}, nil
	}
	f, msg := validateVlan(b.Vid, b.Name, b.Color, b.Description, b.SiteId)
	if msg != "" {
		return apigen.UpdateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := req.VlanId
	v, out, err := s.saveVlan(ctx, m, f, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.gone:
		return apigen.UpdateVlan404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVlanNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateVlan400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.UpdateVlan403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.UpdateVlan409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	level, err := vlanLevel(ctx, s.q, m, v)
	if err != nil {
		return nil, err
	}
	return apigen.UpdateVlan200JSONResponse(toVlan(v, level)), nil
}

func (s *Server) DeleteVlan(ctx context.Context, req apigen.DeleteVlanRequestObject) (apigen.DeleteVlanResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		v, ok, err := loadVlan(ctx, q, m, req.VlanId)
		if err != nil {
			return err
		}
		if !ok {
			out.gone = true
			return errRollback
		}
		if level, err := vlanLevel(ctx, q, m, v); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			out.code = 403
			return errRollback
		}
		if _, err := q.DeleteVlan(ctx, store.DeleteVlanParams{ID: v.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete vlan: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vlan.delete", ObjectType: "vlan",
			ObjectID: uuidStr(v.ID), Before: vlanSnapshot{v.SiteCode, v.Vid, v.Name, v.Color}, Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.gone:
		return apigen.DeleteVlan404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVlanNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteVlan403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteVlan204Response{}, nil
}

// --- subnets ---

func loadSubnet(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetSubnetRow, bool, error) {
	r, u, p, sp := visParams(m)
	sn, err := q.GetSubnet(ctx, store.GetSubnetParams{ID: pgUUID(id), OrganizationID: m.OrgID, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp})
	if errors.Is(err, pgx.ErrNoRows) {
		return sn, false, nil
	}
	if err != nil {
		return sn, false, fmt.Errorf("load subnet: %w", err)
	}
	return sn, true, nil
}

func subnetLevel(ctx context.Context, q store.Querier, m tenant.Membership, sn store.GetSubnetRow) (int, error) {
	return scopeLevel(ctx, q, m, sn.SiteID, sn.SiteUnitID, sn.SitePartnerID)
}

func addrString(a *netip.Addr) *string {
	if a == nil {
		return nil
	}
	v := a.String()
	return &v
}

func toSubnet(sn store.GetSubnetRow, level int) apigen.Subnet {
	return apigen.Subnet{
		Id: uuid.UUID(sn.ID.Bytes), Cidr: sn.Cidr.String(), Vrf: sn.Vrf, Gateway: addrString(sn.Gateway), Description: sn.Description,
		SiteId: optUUID(sn.SiteID), SiteCode: sn.SiteCode, VlanId: optUUID(sn.VlanID), VlanVid: optInt(sn.VlanVid),
		VlanName: sn.VlanName, VlanColor: sn.VlanColor, Size: hostCount(sn.Cidr), UsedCount: sn.UsedCount,
		RangeCount: sn.RangeCount, Access: levelName(level), Version: sn.Version,
	}
}

type subnetFields struct {
	cidr             netip.Prefix
	vrf, description string
	gateway          *netip.Addr
	site, vlan       *uuid.UUID
}

func validateSubnet(cidr string, vrf, gateway, description *string, site, vlan *uuid.UUID) (subnetFields, string) {
	f := subnetFields{vrf: strings.TrimSpace(str(vrf)), description: str(description), site: site, vlan: vlan}
	p, err := netip.ParsePrefix(strings.TrimSpace(cidr))
	if err != nil {
		return f, "Subnet dạng CIDR, vd 10.72.114.0/24"
	}
	f.cidr = netip.PrefixFrom(p.Addr().Unmap(), p.Bits()).Masked()
	switch {
	case tooLong(f.vrf, 64) || tooLong(f.description, 500):
		return f, "Một trường vượt quá độ dài cho phép"
	case f.cidr.Bits() == f.cidr.Addr().BitLen():
		return f, "Subnet phải là một mạng (vd /24), không phải một địa chỉ"
	}
	if gateway != nil && strings.TrimSpace(*gateway) != "" {
		g, err := netip.ParseAddr(strings.TrimSpace(*gateway))
		if err != nil || g.Zone() != "" {
			return f, "Gateway là một địa chỉ IP, vd 10.72.114.1"
		}
		g = g.Unmap()
		first, last := usableBounds(f.cidr)
		if !f.cidr.Contains(g) || !inRange(g, first, last) {
			return f, fmt.Sprintf("Gateway phải là địa chỉ dùng được trong %s (không phải địa chỉ mạng/broadcast)", f.cidr)
		}
		f.gateway = &g
	}
	return f, ""
}

type subnetSnapshot struct {
	Cidr    string `json:"cidr"`
	Vrf     string `json:"vrf,omitempty"`
	Gateway string `json:"gateway,omitempty"`
	Site    string `json:"site,omitempty"`
	Vlan    int32  `json:"vlan,omitempty"`
}

func snapSubnet(sn store.GetSubnetRow) subnetSnapshot {
	g := ""
	if sn.Gateway != nil {
		g = sn.Gateway.String()
	}
	return subnetSnapshot{sn.Cidr.String(), sn.Vrf, g, sn.SiteCode, sn.VlanVid.Int32}
}

func (s *Server) ListSubnets(ctx context.Context, req apigen.ListSubnetsRequestObject) (apigen.ListSubnetsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	r, u, p, sp := visParams(m)
	params := store.ListSubnetsParams{OrganizationID: m.OrgID, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp}
	if req.Params.SiteId != nil {
		params.SiteFilter = pgUUID(*req.Params.SiteId)
	}
	if req.Params.VlanId != nil {
		params.VlanFilter = pgUUID(*req.Params.VlanId)
	}
	if req.Params.Q != nil {
		params.Q = escapeLike(strings.TrimSpace(*req.Params.Q))
	}
	rows, err := s.q.ListSubnets(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list subnets: %w", err)
	}
	out := apigen.SubnetList{Subnets: make([]apigen.Subnet, 0, len(rows))}
	for _, row := range rows {
		sn := store.GetSubnetRow(row)
		level, err := subnetLevel(ctx, s.q, m, sn)
		if err != nil {
			return nil, err
		}
		out.Subnets = append(out.Subnets, toSubnet(sn, level))
	}
	return apigen.ListSubnets200JSONResponse(out), nil
}

// subnetDetail: ranges with usage, addresses of visible devices, and how many others are in use.
func (s *Server) subnetDetail(ctx context.Context, q store.Querier, m tenant.Membership, sn store.GetSubnetRow) (apigen.SubnetDetail, error) {
	level, err := subnetLevel(ctx, q, m, sn)
	if err != nil {
		return apigen.SubnetDetail{}, err
	}
	r, u, p, sp := visParams(m)
	ips, err := q.ListSubnetIPs(ctx, store.ListSubnetIPsParams{OrganizationID: m.OrgID, Vrf: sn.Vrf, Cidr: sn.Cidr,
		Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp})
	if err != nil {
		return apigen.SubnetDetail{}, fmt.Errorf("subnet ips: %w", err)
	}
	ranges, err := q.ListRanges(ctx, store.ListRangesParams{OrganizationID: m.OrgID, SubnetID: sn.ID})
	if err != nil {
		return apigen.SubnetDetail{}, fmt.Errorf("list ranges: %w", err)
	}
	base := toSubnet(sn, level)
	out := apigen.SubnetDetail{
		Id: base.Id, Cidr: base.Cidr, Vrf: base.Vrf, Gateway: base.Gateway, Description: base.Description, SiteId: base.SiteId,
		SiteCode: base.SiteCode, VlanId: base.VlanId, VlanVid: base.VlanVid, VlanName: base.VlanName, VlanColor: base.VlanColor,
		Size: base.Size, UsedCount: base.UsedCount, RangeCount: base.RangeCount, Access: base.Access, Version: base.Version,
		Ips: []apigen.IpAssignment{}, Ranges: make([]apigen.IpRange, 0, len(ranges)),
	}
	hidden := map[netip.Addr]bool{}
	shown := map[netip.Addr]bool{}
	for _, ip := range ips {
		if !ip.Visible {
			hidden[ip.Host] = true
			continue
		}
		shown[ip.Host] = true
		out.Ips = append(out.Ips, toAssignment(ip))
	}
	for h := range hidden {
		if !shown[h] {
			out.HiddenCount++
		}
	}
	for _, rg := range ranges {
		out.Ranges = append(out.Ranges, toRange(rg, ips))
	}
	return out, nil
}

// toAssignment: an interface IP of a device, or a cluster's management IP (deviceId null).
func toAssignment(ip store.ListSubnetIPsRow) apigen.IpAssignment {
	return apigen.IpAssignment{
		Address: ip.Address, Host: ip.Host.String(), Role: apigen.IpRole(ip.Role), Vrf: ip.Vrf, DeviceId: optUUID(ip.DeviceID),
		ClusterId: optUUID(ip.ClusterID), Hostname: ip.Hostname, InterfaceName: ip.InterfaceName,
	}
}

func toRange(rg store.IpRange, ips []store.ListSubnetIPsRow) apigen.IpRange {
	used := map[netip.Addr]bool{}
	for _, ip := range ips {
		if inRange(ip.Host, rg.StartIp, rg.EndIp) {
			used[ip.Host] = true
		}
	}
	return apigen.IpRange{
		Id: uuid.UUID(rg.ID.Bytes), StartIp: rg.StartIp.String(), EndIp: rg.EndIp.String(), Kind: apigen.IpRangeKind(rg.Kind),
		Purpose: rg.Purpose, Size: rangeSize(rg.StartIp, rg.EndIp), UsedCount: int64(len(used)), Version: rg.Version,
	}
}

func (s *Server) GetSubnet(ctx context.Context, req apigen.GetSubnetRequestObject) (apigen.GetSubnetResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sn, ok, err := loadSubnet(ctx, s.q, m, req.SubnetId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetSubnet404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	}
	out, err := s.subnetDetail(ctx, s.q, m, sn)
	if err != nil {
		return nil, err
	}
	return apigen.GetSubnet200JSONResponse(out), nil
}

func (s *Server) saveSubnet(ctx context.Context, m tenant.Membership, f subnetFields, id *uuid.UUID, version int32) (apigen.SubnetDetail, writeOutcome, error) {
	var (
		out    writeOutcome
		detail apigen.SubnetDetail
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		var before store.GetSubnetRow
		if id != nil {
			var ok bool
			var err error
			if before, ok, err = loadSubnet(ctx, q, m, *id); err != nil {
				return err
			}
			if !ok {
				out.gone = true
				return errRollback
			}
			if level, err := subnetLevel(ctx, q, m, before); err != nil {
				return err
			} else if level < tenant.LevelEdit {
				out.code = 403
				return errRollback
			}
		}
		_, code, bad, err := writableSite(ctx, q, m, f.site)
		if err != nil || code != 0 {
			out.code, out.bad = code, bad
			return orRollback(err)
		}
		siteID := pgtype.UUID{}
		if f.site != nil {
			siteID = pgUUID(*f.site)
		}
		// The VLAN must be the subnet's site's VLAN or an organization-wide one.
		vlanID := pgtype.UUID{}
		if f.vlan != nil {
			v, ok, err := loadVlan(ctx, q, m, *f.vlan)
			if err != nil {
				return err
			}
			if !ok || (v.SiteID.Valid && v.SiteID != siteID) {
				out.bad = "VLAN phải thuộc cùng site với subnet (hoặc là VLAN toàn tổ chức)"
				return errRollback
			}
			vlanID = v.ID
		}
		// Existing ranges must still fit a resized subnet.
		if id != nil && f.cidr != before.Cidr {
			ranges, err := q.ListRanges(ctx, store.ListRangesParams{OrganizationID: m.OrgID, SubnetID: before.ID})
			if err != nil {
				return fmt.Errorf("list ranges: %w", err)
			}
			for _, rg := range ranges {
				if !f.cidr.Contains(rg.StartIp) || !f.cidr.Contains(rg.EndIp) {
					out.bad = fmt.Sprintf("Dải %s–%s nằm ngoài %s", rg.StartIp, rg.EndIp, f.cidr)
					return errRollback
				}
			}
		}
		var sid pgtype.UUID
		if id == nil {
			sid, err = q.CreateSubnet(ctx, store.CreateSubnetParams{OrganizationID: m.OrgID, SiteID: siteID, VlanID: vlanID, Cidr: f.cidr, Vrf: f.vrf, Gateway: f.gateway, Description: f.description})
		} else {
			sid = before.ID
			var n int64
			n, err = q.UpdateSubnet(ctx, store.UpdateSubnetParams{ID: before.ID, OrganizationID: m.OrgID, Version: version, SiteID: siteID, VlanID: vlanID, Cidr: f.cidr, Vrf: f.vrf, Gateway: f.gateway, Description: f.description})
			if err == nil && n == 0 {
				out.conf = msgStale
				return errRollback
			}
		}
		if isUniqueViolation(err) {
			out.conf = fmt.Sprintf("Subnet %s đã có trong VRF này", f.cidr)
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save subnet: %w", err)
		}
		after, ok, err := loadSubnet(ctx, q, m, uuid.UUID(sid.Bytes))
		if err != nil || !ok {
			out.code = 403
			return orRollback(err)
		}
		entry := audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "subnet.create", ObjectType: "subnet", ObjectID: uuidStr(sid),
			After: snapSubnet(after), Meta: infoFrom(ctx).meta}
		if id != nil {
			entry.Action, entry.Before = "subnet.update", snapSubnet(before)
		}
		if err := audit.Write(ctx, q, entry); err != nil {
			return err
		}
		detail, err = s.subnetDetail(ctx, q, m, after)
		return err
	})
	return detail, out, err
}

func (s *Server) CreateSubnet(ctx context.Context, req apigen.CreateSubnetRequestObject) (apigen.CreateSubnetResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateSubnet(b.Cidr, b.Vrf, b.Gateway, b.Description, b.SiteId, b.VlanId)
	if msg != "" {
		return apigen.CreateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	d, out, err := s.saveSubnet(ctx, m, f, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.CreateSubnet403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.CreateSubnet409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.CreateSubnet201JSONResponse(d), nil
}

func (s *Server) UpdateSubnet(ctx context.Context, req apigen.UpdateSubnetRequestObject) (apigen.UpdateSubnetResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	if _, ok, err := loadSubnet(ctx, s.q, m, req.SubnetId); err != nil {
		return nil, err
	} else if !ok {
		return apigen.UpdateSubnet404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	}
	f, msg := validateSubnet(b.Cidr, b.Vrf, b.Gateway, b.Description, b.SiteId, b.VlanId)
	if msg != "" {
		return apigen.UpdateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := req.SubnetId
	d, out, err := s.saveSubnet(ctx, m, f, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.gone:
		return apigen.UpdateSubnet404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateSubnet400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.UpdateSubnet403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.UpdateSubnet409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.UpdateSubnet200JSONResponse(d), nil
}

func (s *Server) DeleteSubnet(ctx context.Context, req apigen.DeleteSubnetRequestObject) (apigen.DeleteSubnetResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		sn, ok, err := loadSubnet(ctx, q, m, req.SubnetId)
		if err != nil {
			return err
		}
		if !ok {
			out.gone = true
			return errRollback
		}
		if level, err := subnetLevel(ctx, q, m, sn); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			out.code = 403
			return errRollback
		}
		if _, err := q.DeleteSubnet(ctx, store.DeleteSubnetParams{ID: sn.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete subnet: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "subnet.delete", ObjectType: "subnet",
			ObjectID: uuidStr(sn.ID), Before: snapSubnet(sn), Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.gone:
		return apigen.DeleteSubnet404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteSubnet403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteSubnet204Response{}, nil
}

// NextFreeIp scans the usable addresses for the first one unused by any interface (all devices, same VRF), other than
// the gateway and outside DHCP / reserved ranges.
func (s *Server) NextFreeIp(ctx context.Context, req apigen.NextFreeIpRequestObject) (apigen.NextFreeIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sn, ok, err := loadSubnet(ctx, s.q, m, req.SubnetId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.NextFreeIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	}
	ips, err := s.q.ListSubnetIPs(ctx, store.ListSubnetIPsParams{OrganizationID: m.OrgID, Vrf: sn.Vrf, Cidr: sn.Cidr, Restricted: false})
	if err != nil {
		return nil, fmt.Errorf("subnet ips: %w", err)
	}
	ranges, err := s.q.ListRanges(ctx, store.ListRangesParams{OrganizationID: m.OrgID, SubnetID: sn.ID})
	if err != nil {
		return nil, fmt.Errorf("list ranges: %w", err)
	}
	used := map[netip.Addr]bool{}
	for _, ip := range ips {
		used[ip.Host] = true
	}
	if sn.Gateway != nil {
		used[*sn.Gateway] = true
	}
	first, last := usableBounds(sn.Cidr)
	for a, n := first, 0; a.IsValid() && a.Compare(last) <= 0 && n < nextFreeScanLimit; a, n = a.Next(), n+1 {
		if used[a] {
			continue
		}
		blocked := false
		for _, rg := range ranges {
			if rg.Kind != "static" && inRange(a, rg.StartIp, rg.EndIp) {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		addr, host := netip.PrefixFrom(a, sn.Cidr.Bits()).String(), a.String()
		return apigen.NextFreeIp200JSONResponse{Address: &addr, Host: &host}, nil
	}
	return apigen.NextFreeIp200JSONResponse{}, nil
}

// --- ranges ---

type rangeFields struct {
	start, end    netip.Addr
	kind, purpose string
}

func validateRange(sn store.GetSubnetRow, start, end string, kind apigen.IpRangeKind, purpose *string) (rangeFields, string) {
	f := rangeFields{kind: string(kind), purpose: str(purpose)}
	var err1, err2 error
	f.start, err1 = netip.ParseAddr(strings.TrimSpace(start))
	f.end, err2 = netip.ParseAddr(strings.TrimSpace(end))
	switch {
	case !kind.Valid():
		return f, "Loại dải không hợp lệ"
	case err1 != nil || err2 != nil:
		return f, "Địa chỉ đầu/cuối là địa chỉ IP, vd 10.72.114.100"
	case tooLong(f.purpose, 200):
		return f, "Mục đích tối đa 200 ký tự"
	}
	f.start, f.end = f.start.Unmap(), f.end.Unmap()
	first, last := usableBounds(sn.Cidr)
	switch {
	case !inRange(f.start, first, last) || !inRange(f.end, first, last):
		return f, fmt.Sprintf("Dải phải nằm trong các địa chỉ dùng được của %s", sn.Cidr)
	case f.start.Compare(f.end) > 0:
		return f, "Địa chỉ đầu phải nhỏ hơn hoặc bằng địa chỉ cuối"
	}
	return f, ""
}

type rangeSnapshot struct {
	Subnet  string `json:"subnet"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Kind    string `json:"kind"`
	Purpose string `json:"purpose,omitempty"`
}

// rangeWrite loads the subnet for a range change: 404 when invisible, 403 below edit.
func rangeWrite(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetSubnetRow, int, error) {
	sn, ok, err := loadSubnet(ctx, q, m, id)
	if err != nil {
		return sn, 0, err
	}
	if !ok {
		return sn, 404, nil
	}
	level, err := subnetLevel(ctx, q, m, sn)
	if err != nil {
		return sn, 0, err
	}
	if level < tenant.LevelEdit {
		return sn, 403, nil
	}
	return sn, 0, nil
}

// overlapping returns another range of the subnet that shares an address with [start, end].
func overlapping(ctx context.Context, q store.Querier, m tenant.Membership, sn store.GetSubnetRow, self pgtype.UUID, start, end netip.Addr) (*store.IpRange, error) {
	ranges, err := q.ListRanges(ctx, store.ListRangesParams{OrganizationID: m.OrgID, SubnetID: sn.ID})
	if err != nil {
		return nil, fmt.Errorf("list ranges: %w", err)
	}
	for _, rg := range ranges {
		if rg.ID != self && start.Compare(rg.EndIp) <= 0 && rg.StartIp.Compare(end) <= 0 {
			return &rg, nil
		}
	}
	return nil, nil
}

func (s *Server) rangeUsage(ctx context.Context, m tenant.Membership, sn store.GetSubnetRow, rg store.IpRange) (apigen.IpRange, error) {
	ips, err := s.q.ListSubnetIPs(ctx, store.ListSubnetIPsParams{OrganizationID: m.OrgID, Vrf: sn.Vrf, Cidr: sn.Cidr})
	if err != nil {
		return apigen.IpRange{}, fmt.Errorf("subnet ips: %w", err)
	}
	return toRange(rg, ips), nil
}

func (s *Server) CreateIpRange(ctx context.Context, req apigen.CreateIpRangeRequestObject) (apigen.CreateIpRangeResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateIpRange400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out     writeOutcome
		created store.IpRange
		sn      store.GetSubnetRow
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var code int
		var err error
		if sn, code, err = rangeWrite(ctx, q, m, req.SubnetId); err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		f, msg := validateRange(sn, b.StartIp, b.EndIp, b.Kind, b.Purpose)
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		if other, err := overlapping(ctx, q, m, sn, pgtype.UUID{}, f.start, f.end); err != nil {
			return err
		} else if other != nil {
			out.conf = fmt.Sprintf("Trùng với dải %s–%s", other.StartIp, other.EndIp)
			return errRollback
		}
		if created, err = q.CreateRange(ctx, store.CreateRangeParams{OrganizationID: m.OrgID, SubnetID: sn.ID, StartIp: f.start, EndIp: f.end, Kind: f.kind, Purpose: f.purpose}); err != nil {
			return fmt.Errorf("create range: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "ip_range.create", ObjectType: "subnet",
			ObjectID: uuidStr(sn.ID), After: rangeSnapshot{sn.Cidr.String(), f.start.String(), f.end.String(), f.kind, f.purpose}, Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.code == 404:
		return apigen.CreateIpRange404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	case out.code == 403:
		return apigen.CreateIpRange403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.CreateIpRange400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.CreateIpRange409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	rg, err := s.rangeUsage(ctx, m, sn, created)
	if err != nil {
		return nil, err
	}
	return apigen.CreateIpRange201JSONResponse(rg), nil
}

func (s *Server) UpdateIpRange(ctx context.Context, req apigen.UpdateIpRangeRequestObject) (apigen.UpdateIpRangeResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateIpRange400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out     writeOutcome
		updated store.IpRange
		sn      store.GetSubnetRow
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var code int
		var err error
		if sn, code, err = rangeWrite(ctx, q, m, req.SubnetId); err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		before, err := q.GetRange(ctx, store.GetRangeParams{ID: pgUUID(req.RangeId), OrganizationID: m.OrgID, SubnetID: sn.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load range: %w", err)
		}
		f, msg := validateRange(sn, b.StartIp, b.EndIp, b.Kind, b.Purpose)
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		if other, err := overlapping(ctx, q, m, sn, before.ID, f.start, f.end); err != nil {
			return err
		} else if other != nil {
			out.conf = fmt.Sprintf("Trùng với dải %s–%s", other.StartIp, other.EndIp)
			return errRollback
		}
		updated, err = q.UpdateRange(ctx, store.UpdateRangeParams{ID: before.ID, OrganizationID: m.OrgID, SubnetID: sn.ID, Version: b.Version, StartIp: f.start, EndIp: f.end, Kind: f.kind, Purpose: f.purpose})
		if errors.Is(err, pgx.ErrNoRows) {
			out.conf = msgStale
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update range: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "ip_range.update", ObjectType: "subnet", ObjectID: uuidStr(sn.ID),
			Before: rangeSnapshot{sn.Cidr.String(), before.StartIp.String(), before.EndIp.String(), before.Kind, before.Purpose},
			After:  rangeSnapshot{sn.Cidr.String(), f.start.String(), f.end.String(), f.kind, f.purpose}, Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.code == 404:
		return apigen.UpdateIpRange404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	case out.code == 403:
		return apigen.UpdateIpRange403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.UpdateIpRange404JSONResponse{NotFoundJSONResponse: notFoundBody(msgRangeNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateIpRange400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.UpdateIpRange409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	rg, err := s.rangeUsage(ctx, m, sn, updated)
	if err != nil {
		return nil, err
	}
	return apigen.UpdateIpRange200JSONResponse(rg), nil
}

func (s *Server) DeleteIpRange(ctx context.Context, req apigen.DeleteIpRangeRequestObject) (apigen.DeleteIpRangeResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		sn, code, err := rangeWrite(ctx, q, m, req.SubnetId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		before, err := q.GetRange(ctx, store.GetRangeParams{ID: pgUUID(req.RangeId), OrganizationID: m.OrgID, SubnetID: sn.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load range: %w", err)
		}
		if _, err := q.DeleteRange(ctx, store.DeleteRangeParams{ID: before.ID, OrganizationID: m.OrgID, SubnetID: sn.ID}); err != nil {
			return fmt.Errorf("delete range: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "ip_range.delete", ObjectType: "subnet", ObjectID: uuidStr(sn.ID),
			Before: rangeSnapshot{sn.Cidr.String(), before.StartIp.String(), before.EndIp.String(), before.Kind, before.Purpose}, Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.code == 404:
		return apigen.DeleteIpRange404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSubnetNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteIpRange403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.DeleteIpRange404JSONResponse{NotFoundJSONResponse: notFoundBody(msgRangeNotFound)}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteIpRange204Response{}, nil
}

// --- lookup ---

func (s *Server) LookupIp(ctx context.Context, req apigen.LookupIpRequestObject) (apigen.LookupIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(req.Params.Ip)
	if p, err := netip.ParsePrefix(raw); err == nil {
		raw = p.Addr().String()
	}
	a, err := netip.ParseAddr(raw)
	if err != nil || a.Zone() != "" {
		return apigen.LookupIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Nhập một địa chỉ IP, vd 10.72.114.2"}}, nil
	}
	a = a.Unmap()
	r, u, p, sp := visParams(m)
	subnets, err := s.q.LookupSubnets(ctx, store.LookupSubnetsParams{OrganizationID: m.OrgID, Ip: a, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp})
	if err != nil {
		return nil, fmt.Errorf("lookup subnets: %w", err)
	}
	ips, err := s.q.LookupIPs(ctx, store.LookupIPsParams{OrganizationID: m.OrgID, Ip: a, Restricted: r, GrantUnits: u, GrantPartners: p, SharePartners: sp})
	if err != nil {
		return nil, fmt.Errorf("lookup ips: %w", err)
	}
	out := apigen.IpLookup{Ip: a.String(), Subnets: make([]apigen.Subnet, 0, len(subnets))}
	out.Assignments = make([]apigen.IpAssignment, 0, len(ips))
	for _, row := range subnets {
		sn := store.GetSubnetRow(row)
		level, err := subnetLevel(ctx, s.q, m, sn)
		if err != nil {
			return nil, err
		}
		out.Subnets = append(out.Subnets, toSubnet(sn, level))
	}
	for _, ip := range ips {
		if !ip.Visible {
			out.HiddenCount++
			continue
		}
		out.Assignments = append(out.Assignments, toAssignment(store.ListSubnetIPsRow(ip)))
	}
	return apigen.LookupIp200JSONResponse(out), nil
}
