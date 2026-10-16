package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Endpoint groups (P1-11, SRS §4.4, ADR-013/014): many similar end devices kept as one item with light members.
// Ownership and access follow devices (a site and an owner unit, ADR-031); member IPs count as used in IPAM.

const (
	msgGroupNotFound  = "Không tìm thấy nhóm thiết bị"
	msgMemberNotFound = "Không tìm thấy thành viên"
)

func loadGroup(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetEndpointGroupRow, bool, error) {
	v := visibilityOf(m)
	g, err := q.GetEndpointGroup(ctx, store.GetEndpointGroupParams{
		ID: pgUUID(id), OrganizationID: m.OrgID, Restricted: v.restricted,
		GrantUnits: v.grantUnits, GrantPartners: v.grantPartners, SharePartners: v.sharePts,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return g, false, nil
	}
	if err != nil {
		return g, false, fmt.Errorf("load endpoint group: %w", err)
	}
	return g, true, nil
}

// groupLevel: like a device, the owner unit's level raised by the site's.
func groupLevel(ctx context.Context, q store.Querier, m tenant.Membership, g store.GetEndpointGroupRow) (int, error) {
	sites, err := siteLevels(ctx, q, m, []siteRef{{g.SiteID, g.SiteUnitID, g.SitePartnerID}})
	if err != nil {
		return 0, err
	}
	return max(m.UnitLevel(g.BusinessUnitID, g.PartnerID), sites[g.SiteID]), nil
}

// groupTotal is the badge total: the expected count, else the range size, else the members themselves.
func groupTotal(g store.GetEndpointGroupRow) int64 {
	switch {
	case g.ExpectedCount.Valid:
		return int64(g.ExpectedCount.Int32)
	case g.RangeStart != nil && g.RangeEnd != nil:
		return rangeSize(*g.RangeStart, *g.RangeEnd)
	}
	return g.MemberCount
}

func addrPtr(a *netip.Addr) *string {
	if a == nil {
		return nil
	}
	v := a.String()
	return &v
}

func toGroup(g store.GetEndpointGroupRow, level int) apigen.EndpointGroup {
	return apigen.EndpointGroup{
		Id: uuid.UUID(g.ID.Bytes), Kind: apigen.EndpointKind(g.Kind), Name: g.Name, SiteId: uuid.UUID(g.SiteID.Bytes),
		SiteCode: g.SiteCode, SiteName: g.SiteName, BusinessUnitId: uuid.UUID(g.BusinessUnitID.Bytes), UnitCode: g.UnitCode,
		PartnerCode: g.PartnerCode, IpRangeId: optUUID(g.IpRangeID), RangeStart: addrPtr(g.RangeStart), RangeEnd: addrPtr(g.RangeEnd),
		RangeKind: g.RangeKind, RangePurpose: g.RangePurpose, SubnetId: optUUID(g.SubnetID), SubnetCidr: prefixString(g.SubnetCidr),
		Vrf: g.SubnetVrf, ExpectedCount: optInt(g.ExpectedCount), MemberCount: g.MemberCount, Total: groupTotal(g),
		Notes: g.Notes, Access: levelName(level), Version: g.Version,
	}
}

// memberAddress is the member IP with the subnet's prefix length (10.72.120.15/26), or a host route without a subnet.
func memberAddress(ip *netip.Addr, cidr *netip.Prefix) *string {
	if ip == nil {
		return nil
	}
	bits := ip.BitLen()
	if cidr != nil && cidr.Contains(*ip) {
		bits = cidr.Bits()
	}
	v := netip.PrefixFrom(*ip, bits).String()
	return &v
}

func toEndpointMember(r store.ListEndpointMembersRow, cidr *netip.Prefix) apigen.EndpointMember {
	return apigen.EndpointMember{
		Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Ip: addrPtr(r.Ip), Address: memberAddress(r.Ip, cidr), Mac: optMac(r.Mac),
		InterfaceId: optUUID(r.InterfaceID), InterfaceName: r.InterfaceName, PortDeviceId: optUUID(r.PortDeviceID),
		PortHostname: r.PortHostname, Notes: r.Notes, Version: r.Version,
	}
}

func (s *Server) groupDetail(ctx context.Context, q store.Querier, m tenant.Membership, g store.GetEndpointGroupRow) (apigen.EndpointGroupDetail, error) {
	level, err := groupLevel(ctx, q, m, g)
	if err != nil {
		return apigen.EndpointGroupDetail{}, err
	}
	rows, err := q.ListEndpointMembers(ctx, store.ListEndpointMembersParams{OrganizationID: m.OrgID, GroupID: g.ID})
	if err != nil {
		return apigen.EndpointGroupDetail{}, fmt.Errorf("list members: %w", err)
	}
	b := toGroup(g, level)
	out := apigen.EndpointGroupDetail{
		Id: b.Id, Kind: b.Kind, Name: b.Name, SiteId: b.SiteId, SiteCode: b.SiteCode, SiteName: b.SiteName,
		BusinessUnitId: b.BusinessUnitId, UnitCode: b.UnitCode, PartnerCode: b.PartnerCode, IpRangeId: b.IpRangeId,
		RangeStart: b.RangeStart, RangeEnd: b.RangeEnd, RangeKind: b.RangeKind, RangePurpose: b.RangePurpose,
		SubnetId: b.SubnetId, SubnetCidr: b.SubnetCidr, Vrf: b.Vrf, ExpectedCount: b.ExpectedCount,
		MemberCount: b.MemberCount, Total: b.Total, Notes: b.Notes, Access: b.Access, Version: b.Version,
		Members: make([]apigen.EndpointMember, 0, len(rows)),
	}
	for _, r := range rows {
		out.Members = append(out.Members, toEndpointMember(r, g.SubnetCidr))
	}
	return out, nil
}

// --- groups ---

type groupFields struct {
	kind, name, notes string
	site              uuid.UUID
	unit, rng         *uuid.UUID
	expected          pgtype.Int4
}

func validateGroup(kind apigen.EndpointKind, name string, site uuid.UUID, unit, rng *uuid.UUID, expected *int32, notes *string) (groupFields, string) {
	f := groupFields{kind: string(kind), name: strings.TrimSpace(name), notes: str(notes), site: site, unit: unit, rng: rng}
	if expected != nil {
		f.expected = pgtype.Int4{Int32: *expected, Valid: true}
	}
	switch {
	case !kind.Valid():
		return f, "Loại thiết bị của nhóm không hợp lệ"
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên nhóm bắt buộc, tối đa 100 ký tự"
	case expected != nil && (*expected < 0 || *expected > 100000):
		return f, "Số lượng dự kiến từ 0 đến 100000"
	case tooLong(f.notes, 2000):
		return f, "Ghi chú tối đa 2000 ký tự"
	}
	return f, ""
}

type groupSnapshot struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Site     string `json:"site"`
	Unit     string `json:"unit"`
	Range    string `json:"range,omitempty"`
	Expected int32  `json:"expected,omitempty"`
}

func snapGroup(g store.GetEndpointGroupRow) groupSnapshot {
	r := ""
	if g.RangeStart != nil && g.RangeEnd != nil {
		r = g.RangeStart.String() + "-" + g.RangeEnd.String()
	}
	return groupSnapshot{g.Kind, g.Name, g.SiteCode, g.PartnerCode + "/" + g.UnitCode, r, g.ExpectedCount.Int32}
}

// linkRange checks a range for a group in a site: it exists, its subnet is visible and belongs to the site or the
// whole organization.
func linkRange(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID, site pgtype.UUID) (store.GetRangeWithSubnetRow, string, error) {
	r, err := q.GetRangeWithSubnet(ctx, store.GetRangeWithSubnetParams{ID: pgUUID(id), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return r, "Dải IP không tồn tại", nil
	}
	if err != nil {
		return r, "", fmt.Errorf("load range: %w", err)
	}
	if _, ok, err := loadSubnet(ctx, q, m, uuid.UUID(r.SubnetID.Bytes)); err != nil {
		return r, "", err
	} else if !ok {
		return r, "Dải IP không tồn tại", nil
	}
	if r.SubnetSiteID.Valid && r.SubnetSiteID != site {
		return r, "Dải IP phải thuộc subnet của cùng site (hoặc subnet toàn tổ chức)", nil
	}
	return r, "", nil
}

func (s *Server) ListEndpointGroups(ctx context.Context, req apigen.ListEndpointGroupsRequestObject) (apigen.ListEndpointGroupsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	v := visibilityOf(m)
	params := store.ListEndpointGroupsParams{OrganizationID: m.OrgID, Restricted: v.restricted, GrantUnits: v.grantUnits,
		GrantPartners: v.grantPartners, SharePartners: v.sharePts}
	if req.Params.SiteId != nil {
		params.SiteFilter = pgUUID(*req.Params.SiteId)
	}
	rows, err := s.q.ListEndpointGroups(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list endpoint groups: %w", err)
	}
	out := apigen.EndpointGroupList{Groups: make([]apigen.EndpointGroup, 0, len(rows))}
	for _, row := range rows {
		g := store.GetEndpointGroupRow(row)
		level, err := groupLevel(ctx, s.q, m, g)
		if err != nil {
			return nil, err
		}
		out.Groups = append(out.Groups, toGroup(g, level))
	}
	return apigen.ListEndpointGroups200JSONResponse(out), nil
}

func (s *Server) GetEndpointGroup(ctx context.Context, req apigen.GetEndpointGroupRequestObject) (apigen.GetEndpointGroupResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, ok, err := loadGroup(ctx, s.q, m, req.GroupId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetEndpointGroup404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	}
	d, err := s.groupDetail(ctx, s.q, m, g)
	if err != nil {
		return nil, err
	}
	return apigen.GetEndpointGroup200JSONResponse(d), nil
}

func (s *Server) saveGroup(ctx context.Context, m tenant.Membership, f groupFields, id *uuid.UUID, version int32) (apigen.EndpointGroupDetail, writeOutcome, error) {
	var (
		out    writeOutcome
		detail apigen.EndpointGroupDetail
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		var before store.GetEndpointGroupRow
		keep := pgtype.UUID{}
		if id != nil {
			var ok bool
			var err error
			if before, ok, err = loadGroup(ctx, q, m, *id); err != nil {
				return err
			}
			if !ok {
				out.gone = true
				return errRollback
			}
			if level, err := groupLevel(ctx, q, m, before); err != nil {
				return err
			} else if level < tenant.LevelEdit {
				out.code = 403
				return errRollback
			}
			keep = before.BusinessUnitID
		}
		p, bad, err := resolvePlacement(ctx, q, m, deviceFields{site: f.site, unit: f.unit, uHeight: 1}, pgtype.UUID{}, keep)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		moved := id == nil || p.unit != before.BusinessUnitID || p.site.ID != before.SiteID
		if moved && (m.UnitLevel(p.unit, p.unitPartner) < tenant.LevelEdit ||
			(id != nil && m.UnitLevel(before.BusinessUnitID, before.PartnerID) < tenant.LevelEdit)) {
			out.code = 403
			return errRollback
		}
		var rng pgtype.UUID
		if f.rng != nil {
			r, bad, err := linkRange(ctx, q, m, *f.rng, p.site.ID)
			if err != nil || bad != "" {
				out.bad = bad
				return orRollback(err)
			}
			rng = r.ID
			// Members already addressed must fit the newly linked range.
			if id != nil && r.ID != before.IpRangeID {
				members, err := q.ListEndpointMembers(ctx, store.ListEndpointMembersParams{OrganizationID: m.OrgID, GroupID: before.ID})
				if err != nil {
					return fmt.Errorf("list members: %w", err)
				}
				for _, mb := range members {
					if mb.Ip != nil && !inRange(*mb.Ip, r.StartIp, r.EndIp) {
						out.bad = fmt.Sprintf("Thành viên %s (%s) nằm ngoài dải %s–%s", mb.Name, mb.Ip, r.StartIp, r.EndIp)
						return errRollback
					}
				}
			}
		}
		var gid pgtype.UUID
		if id == nil {
			gid, err = q.CreateEndpointGroup(ctx, store.CreateEndpointGroupParams{
				OrganizationID: m.OrgID, BusinessUnitID: p.unit, SiteID: p.site.ID, Kind: f.kind, Name: f.name,
				IpRangeID: rng, ExpectedCount: f.expected, Notes: f.notes,
			})
		} else {
			gid = before.ID
			var n int64
			n, err = q.UpdateEndpointGroup(ctx, store.UpdateEndpointGroupParams{
				ID: before.ID, OrganizationID: m.OrgID, Version: version, BusinessUnitID: p.unit, SiteID: p.site.ID,
				Kind: f.kind, Name: f.name, IpRangeID: rng, ExpectedCount: f.expected, Notes: f.notes,
			})
			if err == nil && n == 0 {
				out.conf = msgStale
				return errRollback
			}
		}
		if isUniqueViolation(err) {
			out.conf = fmt.Sprintf("Site %s đã có nhóm tên %s", p.site.Code, f.name)
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save endpoint group: %w", err)
		}
		after, ok, err := loadGroup(ctx, q, m, uuid.UUID(gid.Bytes))
		if err != nil || !ok {
			out.code = 403
			return orRollback(err)
		}
		entry := audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_group.create", ObjectType: "endpoint_group",
			ObjectID: uuidStr(gid), After: snapGroup(after), Meta: infoFrom(ctx).meta}
		if id != nil {
			entry.Action, entry.Before = "endpoint_group.update", snapGroup(before)
		}
		if err := audit.Write(ctx, q, entry); err != nil {
			return err
		}
		detail, err = s.groupDetail(ctx, q, m, after)
		return err
	})
	return detail, out, err
}

func (s *Server) CreateEndpointGroup(ctx context.Context, req apigen.CreateEndpointGroupRequestObject) (apigen.CreateEndpointGroupResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateGroup(b.Kind, b.Name, b.SiteId, b.BusinessUnitId, b.IpRangeId, b.ExpectedCount, b.Notes)
	if msg != "" {
		return apigen.CreateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	d, out, err := s.saveGroup(ctx, m, f, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.CreateEndpointGroup403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.CreateEndpointGroup409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.CreateEndpointGroup201JSONResponse(d), nil
}

func (s *Server) UpdateEndpointGroup(ctx context.Context, req apigen.UpdateEndpointGroupRequestObject) (apigen.UpdateEndpointGroupResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	if _, ok, err := loadGroup(ctx, s.q, m, req.GroupId); err != nil {
		return nil, err
	} else if !ok {
		return apigen.UpdateEndpointGroup404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	}
	f, msg := validateGroup(b.Kind, b.Name, b.SiteId, b.BusinessUnitId, b.IpRangeId, b.ExpectedCount, b.Notes)
	if msg != "" {
		return apigen.UpdateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := req.GroupId
	d, out, err := s.saveGroup(ctx, m, f, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.gone:
		return apigen.UpdateEndpointGroup404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateEndpointGroup400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.UpdateEndpointGroup403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.UpdateEndpointGroup409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.UpdateEndpointGroup200JSONResponse(d), nil
}

func (s *Server) DeleteEndpointGroup(ctx context.Context, req apigen.DeleteEndpointGroupRequestObject) (apigen.DeleteEndpointGroupResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		g, code, err := groupWrite(ctx, q, m, req.GroupId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		if err := deleteLinksOf(ctx, q, m, "endpoint_group", g.ID); err != nil {
			return err
		}
		if _, err := q.DeleteEndpointGroup(ctx, store.DeleteEndpointGroupParams{ID: g.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete endpoint group: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_group.delete",
			ObjectType: "endpoint_group", ObjectID: uuidStr(g.ID), Before: snapGroup(g), Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.code == 404:
		return apigen.DeleteEndpointGroup404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteEndpointGroup403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteEndpointGroup204Response{}, nil
}

// --- members ---

// groupWrite loads a group for a change: 404 when invisible, 403 below edit.
func groupWrite(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetEndpointGroupRow, int, error) {
	g, ok, err := loadGroup(ctx, q, m, id)
	if err != nil {
		return g, 0, err
	}
	if !ok {
		return g, 404, nil
	}
	level, err := groupLevel(ctx, q, m, g)
	if err != nil {
		return g, 0, err
	}
	if level < tenant.LevelEdit {
		return g, 403, nil
	}
	return g, 0, nil
}

type memberFields struct {
	name, notes string
	ip          *netip.Addr
	mac         net.HardwareAddr
	port        pgtype.UUID
}

type endpointMemberSnapshot struct {
	Name string `json:"name"`
	IP   string `json:"ip,omitempty"`
	MAC  string `json:"mac,omitempty"`
	Port string `json:"port,omitempty"`
}

func snapEndpointMember(name string, ip *netip.Addr, mac net.HardwareAddr, port pgtype.UUID) endpointMemberSnapshot {
	sn := endpointMemberSnapshot{Name: name, MAC: macString(mac)}
	if ip != nil {
		sn.IP = ip.String()
	}
	if port.Valid {
		sn.Port = uuidStr(port)
	}
	return sn
}

// checkMember validates a member against its group: IP inside the group's range, a physical port of a visible
// device in the group's site.
func checkMember(ctx context.Context, q store.Querier, m tenant.Membership, g store.GetEndpointGroupRow, name string, ip, mac *string, port *uuid.UUID, notes *string) (memberFields, string, error) {
	f := memberFields{name: strings.TrimSpace(name), notes: str(notes)}
	switch {
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên thành viên bắt buộc, tối đa 100 ký tự", nil
	case tooLong(f.notes, 500):
		return f, "Ghi chú tối đa 500 ký tự", nil
	}
	if ip != nil && strings.TrimSpace(*ip) != "" {
		raw := strings.TrimSpace(*ip)
		if p, err := netip.ParsePrefix(raw); err == nil {
			raw = p.Addr().String()
		}
		a, err := netip.ParseAddr(raw)
		if err != nil || a.Zone() != "" {
			return f, "IP là một địa chỉ, vd 10.72.120.15", nil
		}
		a = a.Unmap()
		if g.RangeStart != nil && g.RangeEnd != nil && !inRange(a, *g.RangeStart, *g.RangeEnd) {
			return f, fmt.Sprintf("IP phải nằm trong dải %s–%s của nhóm", g.RangeStart, g.RangeEnd), nil
		}
		f.ip = &a
	}
	if mac != nil && strings.TrimSpace(*mac) != "" {
		hw, err := net.ParseMAC(strings.TrimSpace(*mac))
		if err != nil || len(hw) != 6 {
			return f, "MAC không hợp lệ, vd aa:bb:cc:dd:ee:ff hoặc aabb.ccdd.eeff", nil
		}
		f.mac = hw
	}
	if port != nil {
		pi, err := q.GetPortInterface(ctx, store.GetPortInterfaceParams{ID: pgUUID(*port), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			return f, "Cổng switch không tồn tại", nil
		}
		if err != nil {
			return f, "", fmt.Errorf("load port: %w", err)
		}
		if _, ok, err := loadDevice(ctx, q, m, uuid.UUID(pi.DeviceID.Bytes)); err != nil {
			return f, "", err
		} else if !ok {
			return f, "Cổng switch không tồn tại", nil
		}
		if pi.SiteID != g.SiteID {
			return f, fmt.Sprintf("Cổng switch phải thuộc thiết bị ở site %s", g.SiteCode), nil
		}
		if pi.Kind != "physical" {
			return f, fmt.Sprintf("%s là interface ảo — thiết bị chỉ cắm được vào cổng vật lý", pi.Name), nil
		}
		f.port = pi.ID
	}
	return f, "", nil
}

func (s *Server) memberRow(ctx context.Context, q store.Querier, m tenant.Membership, g store.GetEndpointGroupRow, id pgtype.UUID) (apigen.EndpointMember, error) {
	rows, err := q.ListEndpointMembers(ctx, store.ListEndpointMembersParams{OrganizationID: m.OrgID, GroupID: g.ID})
	if err != nil {
		return apigen.EndpointMember{}, fmt.Errorf("list members: %w", err)
	}
	for _, r := range rows {
		if r.ID == id {
			return toEndpointMember(r, g.SubnetCidr), nil
		}
	}
	return apigen.EndpointMember{}, fmt.Errorf("member %s vanished", uuidStr(id))
}

func (s *Server) CreateEndpointMember(ctx context.Context, req apigen.CreateEndpointMemberRequestObject) (apigen.CreateEndpointMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateEndpointMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out     writeOutcome
		created apigen.EndpointMember
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		g, code, err := groupWrite(ctx, q, m, req.GroupId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		f, bad, err := checkMember(ctx, q, m, g, b.Name, b.Ip, b.Mac, b.InterfaceId, b.Notes)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		mid, err := q.CreateEndpointMember(ctx, store.CreateEndpointMemberParams{OrganizationID: m.OrgID, GroupID: g.ID,
			Name: f.name, Ip: f.ip, Mac: f.mac, InterfaceID: f.port, Notes: f.notes})
		if isUniqueViolation(err) {
			out.conf = "Tên hoặc IP đã có trong nhóm"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create member: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_member.create",
			ObjectType: "endpoint_group", ObjectID: uuidStr(g.ID), After: snapEndpointMember(f.name, f.ip, f.mac, f.port), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		created, err = s.memberRow(ctx, q, m, g, mid)
		return err
	})
	switch {
	case out.code == 404:
		return apigen.CreateEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.code == 403:
		return apigen.CreateEndpointMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.CreateEndpointMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.CreateEndpointMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateEndpointMember201JSONResponse(created), nil
}

func (s *Server) UpdateEndpointMember(ctx context.Context, req apigen.UpdateEndpointMemberRequestObject) (apigen.UpdateEndpointMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateEndpointMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out     writeOutcome
		updated apigen.EndpointMember
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		g, code, err := groupWrite(ctx, q, m, req.GroupId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		before, err := q.GetEndpointMember(ctx, store.GetEndpointMemberParams{ID: pgUUID(req.MemberId), OrganizationID: m.OrgID, GroupID: g.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		f, bad, err := checkMember(ctx, q, m, g, b.Name, b.Ip, b.Mac, b.InterfaceId, b.Notes)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		n, err := q.UpdateEndpointMember(ctx, store.UpdateEndpointMemberParams{ID: before.ID, OrganizationID: m.OrgID, GroupID: g.ID,
			Version: b.Version, Name: f.name, Ip: f.ip, Mac: f.mac, InterfaceID: f.port, Notes: f.notes})
		if isUniqueViolation(err) {
			out.conf = "Tên hoặc IP đã có trong nhóm"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update member: %w", err)
		}
		if n == 0 {
			out.conf = msgStale
			return errRollback
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_member.update",
			ObjectType: "endpoint_group", ObjectID: uuidStr(g.ID), Before: snapEndpointMember(before.Name, before.Ip, before.Mac, before.InterfaceID),
			After: snapEndpointMember(f.name, f.ip, f.mac, f.port), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		updated, err = s.memberRow(ctx, q, m, g, before.ID)
		return err
	})
	switch {
	case out.code == 404:
		return apigen.UpdateEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.code == 403:
		return apigen.UpdateEndpointMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.UpdateEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgMemberNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateEndpointMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.UpdateEndpointMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateEndpointMember200JSONResponse(updated), nil
}

func (s *Server) DeleteEndpointMember(ctx context.Context, req apigen.DeleteEndpointMemberRequestObject) (apigen.DeleteEndpointMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		g, code, err := groupWrite(ctx, q, m, req.GroupId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		before, err := q.GetEndpointMember(ctx, store.GetEndpointMemberParams{ID: pgUUID(req.MemberId), OrganizationID: m.OrgID, GroupID: g.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		if _, err := q.DeleteEndpointMember(ctx, store.DeleteEndpointMemberParams{ID: before.ID, OrganizationID: m.OrgID, GroupID: g.ID}); err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_member.delete",
			ObjectType: "endpoint_group", ObjectID: uuidStr(g.ID), Before: snapEndpointMember(before.Name, before.Ip, before.Mac, before.InterfaceID),
			Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.code == 404:
		return apigen.DeleteEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteEndpointMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.DeleteEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgMemberNotFound)}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteEndpointMember204Response{}, nil
}

// PromoteEndpointMember turns a member into a device of the group's type, site and unit in one transaction: an
// "eth0" interface carries its MAC and IP (the management interface) and is linked to the member's switch port when
// that port is free (P1-12), and the member leaves the group.
func (s *Server) PromoteEndpointMember(ctx context.Context, req apigen.PromoteEndpointMemberRequestObject) (apigen.PromoteEndpointMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		out  writeOutcome
		dout deviceOutcome
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		g, code, err := groupWrite(ctx, q, m, req.GroupId)
		if err != nil || code != 0 {
			out.code = code
			return orRollback(err)
		}
		mb, err := q.GetEndpointMember(ctx, store.GetEndpointMemberParams{ID: pgUUID(req.MemberId), OrganizationID: m.OrgID, GroupID: g.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		hostname := mb.Name
		if req.Body != nil && req.Body.Hostname != nil && strings.TrimSpace(*req.Body.Hostname) != "" {
			hostname = *req.Body.Hostname
		}
		// The switch port becomes a real link when it is still free; otherwise it is kept in the notes.
		notes, linkPort, linkDevice := mb.Notes, pgtype.UUID{}, pgtype.UUID{}
		if mb.InterfaceID.Valid {
			pi, err := q.GetPortInterface(ctx, store.GetPortInterfaceParams{ID: mb.InterfaceID, OrganizationID: m.OrgID})
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("load port: %w", err)
			}
			if err == nil {
				if err := q.LockInterfaceLinks(ctx, m.OrgID.String()+"/iface/"+uuidStr(pi.ID)); err != nil {
					return fmt.Errorf("lock interface: %w", err)
				}
				n, err := q.CountPhysicalLinksOnInterface(ctx, store.CountPhysicalLinksOnInterfaceParams{OrganizationID: m.OrgID, InterfaceID: pi.ID})
				if err != nil {
					return fmt.Errorf("count port links: %w", err)
				}
				if n == 0 && pi.Kind == "physical" {
					linkPort, linkDevice = pi.ID, pi.DeviceID
				} else {
					notes = strings.TrimSpace(fmt.Sprintf("%s\nCắm vào %s %s (từ nhóm %s; cổng đã có link khác)", notes, pi.Hostname, pi.Name, g.Name))
				}
			}
		}
		unit := uuid.UUID(g.BusinessUnitID.Bytes)
		f, bad := validateDevice(deviceBody{Hostname: hostname, Type: apigen.DeviceType(g.Kind), SiteId: uuid.UUID(g.SiteID.Bytes),
			BusinessUnitId: &unit, Notes: &notes})
		if bad != "" {
			out.bad = bad + " (đặt hostname khác khi tách)"
			return errRollback
		}
		if err := writeDevice(ctx, q, m, f, nil, 0, &dout); err != nil {
			return err
		}
		if dout.bad != "" || dout.conflict != "" || dout.forbidden {
			return errRollback
		}
		dev := dout.device.ID
		if mb.Ip != nil || len(mb.Mac) > 0 || linkPort.Valid {
			ifc, err := q.CreateInterface(ctx, store.CreateInterfaceParams{OrganizationID: m.OrgID, DeviceID: dev, Name: "eth0",
				Kind: "physical", Media: "RJ45", Duplex: "auto", AdminUp: true, Mac: mb.Mac})
			if err != nil {
				return fmt.Errorf("create interface: %w", err)
			}
			if linkPort.Valid {
				if _, err := q.CreateLink(ctx, store.CreateLinkParams{OrganizationID: m.OrgID, AKind: "device", AID: dev, AInterfaceID: ifc.ID,
					BKind: "device", BID: linkDevice, BInterfaceID: linkPort, Kind: "ethernet", Status: "up"}); err != nil {
					return fmt.Errorf("create link: %w", err)
				}
			}
			if mb.Ip != nil {
				bits := mb.Ip.BitLen()
				if g.SubnetCidr != nil && g.SubnetCidr.Contains(*mb.Ip) {
					bits = g.SubnetCidr.Bits()
				}
				if _, err := q.CreateIP(ctx, store.CreateIPParams{OrganizationID: m.OrgID, DeviceID: dev, InterfaceID: ifc.ID,
					Address: netip.PrefixFrom(*mb.Ip, bits), Vrf: g.SubnetVrf, Role: "primary"}); err != nil {
					return fmt.Errorf("create ip: %w", err)
				}
				if err := q.SetDeviceMgmtInterface(ctx, store.SetDeviceMgmtInterfaceParams{ID: dev, OrganizationID: m.OrgID, InterfaceID: ifc.ID}); err != nil {
					return fmt.Errorf("set management interface: %w", err)
				}
			}
		}
		if _, err := q.DeleteEndpointMember(ctx, store.DeleteEndpointMemberParams{ID: mb.ID, OrganizationID: m.OrgID, GroupID: g.ID}); err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "endpoint_member.promote",
			ObjectType: "endpoint_group", ObjectID: uuidStr(g.ID), Before: snapEndpointMember(mb.Name, mb.Ip, mb.Mac, mb.InterfaceID),
			After: map[string]string{"device": uuidStr(dev), "hostname": f.hostname}, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		dout.device, _, err = loadDevice(ctx, q, m, uuid.UUID(dev.Bytes))
		return err
	})
	switch {
	case out.code == 404:
		return apigen.PromoteEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGroupNotFound)}, nil
	case out.code == 403 || dout.forbidden:
		return apigen.PromoteEndpointMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.PromoteEndpointMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgMemberNotFound)}, nil
	case out.bad != "" || dout.bad != "":
		return apigen.PromoteEndpointMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad + dout.bad}}, nil
	case dout.conflict != "":
		return apigen.PromoteEndpointMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: dout.conflict}}, nil
	case err != nil:
		return nil, err
	}
	level, err := deviceLevel(ctx, s.q, m, dout.device)
	if err != nil {
		return nil, err
	}
	return apigen.PromoteEndpointMember201JSONResponse(toDevice(dout.device, level)), nil
}
