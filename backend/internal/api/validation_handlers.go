package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// ValidationContext gives the diagram checks (P1-20, SRS §7) what they need about the objects on a diagram, plus the
// conflicts that only the whole organization can tell (duplicate hostname, serial, IP in the same VRF).
func (s *Server) ValidationContext(ctx context.Context, req apigen.ValidationContextRequestObject) (apigen.ValidationContextResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || len(req.Body.DeviceIds) > 5000 || len(req.Body.GroupIds) > 5000 {
		return apigen.ValidationContext400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Tối đa 5000 đối tượng"}}, nil
	}
	ids := pgUUIDs(req.Body.DeviceIds)
	gids := pgUUIDs(req.Body.GroupIds)
	out, err := validationContext(ctx, s.q, m, ids, gids)
	if err != nil {
		return nil, err
	}
	return apigen.ValidationContext200JSONResponse(out), nil
}

func pgUUIDs(in []uuid.UUID) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(in))
	for _, id := range uniqueIDs(in) {
		out = append(out, pgUUID(id))
	}
	return out
}

func validationContext(ctx context.Context, q store.Querier, m tenant.Membership, ids, gids []pgtype.UUID) (apigen.ValidationContext, error) {
	out := apigen.ValidationContext{Devices: []apigen.ValDevice{}, Interfaces: []apigen.ValInterface{}, Ips: []apigen.ValIp{},
		Links: []apigen.ValLink{}, Subnets: []apigen.ValSubnet{}, Groups: []apigen.ValGroup{}, Conflicts: []apigen.ValConflict{}}
	org := m.OrgID
	devs, err := q.ValidationDevices(ctx, store.ValidationDevicesParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("validation devices: %w", err)
	}
	for _, d := range devs {
		out.Devices = append(out.Devices, apigen.ValDevice{Id: uuid.UUID(d.ID.Bytes), Hostname: d.Hostname, Type: d.Type,
			SerialNumber: d.SerialNumber, Model: d.Model, Firmware: d.Firmware, Lifecycle: d.Lifecycle, ClusterId: optUUID(d.ClusterID),
			SiteId: uuid.UUID(d.SiteID.Bytes), LocationId: optUUID(d.LocationID), MgmtInterfaceId: optUUID(d.MgmtInterfaceID)})
	}
	ifs, err := q.ValidationInterfaces(ctx, store.ValidationInterfacesParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("validation interfaces: %w", err)
	}
	for _, i := range ifs {
		out.Interfaces = append(out.Interfaces, apigen.ValInterface{Id: uuid.UUID(i.ID.Bytes), DeviceId: uuid.UUID(i.DeviceID.Bytes),
			Name: i.Name, Kind: i.Kind, Media: i.Media, Speed: i.Speed, Mode: i.Mode, AccessVlan: optInt(i.AccessVlan),
			NativeVlan: optInt(i.NativeVlan), AllowedVlans: i.AllowedVlans, LagId: optUUID(i.LagID)})
	}
	ips, err := q.ValidationIps(ctx, store.ValidationIpsParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("validation ips: %w", err)
	}
	for _, ip := range ips {
		out.Ips = append(out.Ips, apigen.ValIp{DeviceId: uuid.UUID(ip.DeviceID.Bytes), InterfaceId: optUUID(ip.InterfaceID),
			Address: ip.Address, Vrf: ip.Vrf, Role: ip.Role})
	}
	ends := append(append([]pgtype.UUID{}, ids...), gids...)
	links, err := q.ValidationLinks(ctx, store.ValidationLinksParams{OrganizationID: org, Ids: ends})
	if err != nil {
		return out, fmt.Errorf("validation links: %w", err)
	}
	for _, l := range links {
		out.Links = append(out.Links, apigen.ValLink{Id: uuid.UUID(l.ID.Bytes), Kind: l.Kind, AKind: l.AKind, AId: uuid.UUID(l.AID.Bytes),
			AInterfaceId: optUUID(l.AInterfaceID), BKind: l.BKind, BId: uuid.UUID(l.BID.Bytes), BInterfaceId: optUUID(l.BInterfaceID)})
	}
	subnets, err := q.ValidationSubnets(ctx, org)
	if err != nil {
		return out, fmt.Errorf("validation subnets: %w", err)
	}
	for _, sn := range subnets {
		out.Subnets = append(out.Subnets, apigen.ValSubnet{Id: uuid.UUID(sn.ID.Bytes), Cidr: sn.Cidr, Vrf: sn.Vrf, Gateway: sn.Gateway})
	}
	groups, err := q.ValidationGroups(ctx, store.ValidationGroupsParams{OrganizationID: org, Ids: gids})
	if err != nil {
		return out, fmt.Errorf("validation groups: %w", err)
	}
	members, err := q.ValidationGroupMembers(ctx, store.ValidationGroupMembersParams{OrganizationID: org, Ids: gids})
	if err != nil {
		return out, fmt.Errorf("validation members: %w", err)
	}
	byGroup := map[pgtype.UUID][]apigen.ValGroupMember{}
	for _, mb := range members {
		byGroup[mb.GroupID] = append(byGroup[mb.GroupID], apigen.ValGroupMember{Name: mb.Name, Ip: mb.Ip})
	}
	for _, g := range groups {
		mbs := byGroup[g.ID]
		if mbs == nil {
			mbs = []apigen.ValGroupMember{}
		}
		out.Groups = append(out.Groups, apigen.ValGroup{Id: uuid.UUID(g.ID.Bytes), Name: g.Name, RangeStart: g.RangeStart, RangeEnd: g.RangeEnd, Members: mbs})
	}
	hosts, err := q.DuplicateHostnames(ctx, store.DuplicateHostnamesParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("duplicate hostnames: %w", err)
	}
	for _, h := range hosts {
		out.Conflicts = append(out.Conflicts, apigen.ValConflict{Kind: apigen.ValConflictKindHostname, Severity: apigen.ValConflictSeverityError, DeviceId: uuid.UUID(h.ID.Bytes), Value: h.Other, Other: h.Other})
	}
	serials, err := q.DuplicateSerials(ctx, store.DuplicateSerialsParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("duplicate serials: %w", err)
	}
	for _, sr := range serials {
		out.Conflicts = append(out.Conflicts, apigen.ValConflict{Kind: apigen.ValConflictKindSerial, Severity: apigen.ValConflictSeverityError, DeviceId: uuid.UUID(sr.ID.Bytes), Value: sr.SerialNumber, Other: sr.Other})
	}
	dupIPs, err := q.DuplicateIps(ctx, store.DuplicateIpsParams{OrganizationID: org, Ids: ids})
	if err != nil {
		return out, fmt.Errorf("duplicate ips: %w", err)
	}
	for _, d := range dupIPs {
		out.Conflicts = append(out.Conflicts, apigen.ValConflict{Kind: apigen.ValConflictKindIp, Severity: apigen.ValConflictSeverity(d.Severity), DeviceId: uuid.UUID(d.DeviceID.Bytes), Value: d.Address, Other: d.Other, OtherInterface: d.OtherInterface})
	}
	return out, nil
}
