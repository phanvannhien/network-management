package api

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Device clusters (P1-09b, ADR-027): an HA pair, a stack, vPC/VSS. A cluster sits in one site and belongs to one
// unit like its members; members join through the device form (clusterId on the device). Access follows devices:
// the cluster's unit level, raised by its site's shares.

const msgClusterNotFound = "Không tìm thấy cụm thiết bị"

// clusterTypes lists the device types each cluster kind applies to (ADR-027, chốt 2026-10-16); "other" is open.
var clusterTypes = map[string][]string{
	"ha_active_passive": haTypes,
	"ha_active_active":  haTypes,
	"stack":             {"l2_switch", "l3_switch", "poe_switch"},
	"vpc":               {"l2_switch", "l3_switch"},
	"vss":               {"l2_switch", "l3_switch"},
}

var haTypes = []string{
	"firewall", "router", "vpn_gateway", "load_balancer", "wireless_controller", "waf", "proxy", "ids_ips",
	"sdwan_edge", "server", "nas",
}

var clusterKindLabels = map[string]string{
	"ha_active_passive": "HA active-passive", "ha_active_active": "HA active-active", "stack": "Stack",
	"vpc": "vPC", "vss": "VSS", "other": "Khác",
}

// clusterFits reports whether a device type may join a cluster of the kind.
func clusterFits(kind, deviceType string) bool {
	types, limited := clusterTypes[kind]
	return !limited || slices.Contains(types, deviceType)
}

// checkMemberType: the type fits the kind and matches the other members (members of a cluster share one type).
// Returns a 400 message or "".
func checkMemberType(ctx context.Context, q store.Querier, m tenant.Membership, c store.GetClusterRow, self pgtype.UUID, deviceType string) (string, error) {
	if !clusterFits(c.Kind, deviceType) {
		return fmt.Sprintf("Loại thiết bị này không dùng được cho cụm kiểu %s (dùng kiểu Khác nếu là trường hợp đặc biệt)", clusterKindLabels[c.Kind]), nil
	}
	members, err := q.ListClusterMembers(ctx, store.ListClusterMembersParams{OrganizationID: m.OrgID, ClusterID: c.ID})
	if err != nil {
		return "", fmt.Errorf("list members: %w", err)
	}
	for _, mb := range members {
		if mb.ID != self && mb.Type != deviceType {
			return fmt.Sprintf("Thành viên cụm %s phải cùng loại thiết bị (%s là %s)", c.Name, mb.Hostname, mb.Type), nil
		}
	}
	return "", nil
}

func loadCluster(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetClusterRow, bool, error) {
	v := visibilityOf(m)
	c, err := q.GetCluster(ctx, store.GetClusterParams{
		ID: pgUUID(id), OrganizationID: m.OrgID, Restricted: v.restricted,
		GrantUnits: v.grantUnits, GrantPartners: v.grantPartners, SharePartners: v.sharePts,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, nil
	}
	if err != nil {
		return c, false, fmt.Errorf("load cluster: %w", err)
	}
	return c, true, nil
}

func clusterLevel(ctx context.Context, q store.Querier, m tenant.Membership, c store.GetClusterRow) (int, error) {
	sites, err := siteLevels(ctx, q, m, []siteRef{{c.SiteID, c.SiteUnitID, c.SitePartnerID}})
	if err != nil {
		return 0, err
	}
	return max(m.UnitLevel(c.BusinessUnitID, c.PartnerID), sites[c.SiteID]), nil
}

func prefixString(p *netip.Prefix) *string {
	if p == nil {
		return nil
	}
	s := p.String()
	return &s
}

func toCluster(c store.GetClusterRow, level int) apigen.Cluster {
	return apigen.Cluster{
		Id: uuid.UUID(c.ID.Bytes), Kind: apigen.ClusterKind(c.Kind), Name: c.Name, Hostname: c.Hostname,
		MgmtIp: prefixString(c.MgmtIp), Notes: c.Notes, SiteId: uuid.UUID(c.SiteID.Bytes), SiteCode: c.SiteCode,
		SiteName: c.SiteName, BusinessUnitId: uuid.UUID(c.BusinessUnitID.Bytes), UnitCode: c.UnitCode,
		PartnerCode: c.PartnerCode, MemberCount: c.MemberCount, MemberHostnames: c.MemberHostnames, MemberType: c.MemberType,
		Access: levelName(level), Version: c.Version,
	}
}

func (s *Server) clusterDetail(ctx context.Context, q store.Querier, m tenant.Membership, c store.GetClusterRow) (apigen.ClusterDetail, error) {
	level, err := clusterLevel(ctx, q, m, c)
	if err != nil {
		return apigen.ClusterDetail{}, err
	}
	rows, err := q.ListClusterMembers(ctx, store.ListClusterMembersParams{OrganizationID: m.OrgID, ClusterID: c.ID})
	if err != nil {
		return apigen.ClusterDetail{}, fmt.Errorf("list members: %w", err)
	}
	base := toCluster(c, level)
	out := apigen.ClusterDetail{
		Access: base.Access, BusinessUnitId: base.BusinessUnitId, Hostname: base.Hostname, Id: base.Id, Kind: base.Kind,
		MemberCount: base.MemberCount, MemberHostnames: base.MemberHostnames, MgmtIp: base.MgmtIp, Name: base.Name, MemberType: base.MemberType,
		Notes: base.Notes, PartnerCode: base.PartnerCode, SiteCode: base.SiteCode, SiteId: base.SiteId,
		SiteName: base.SiteName, UnitCode: base.UnitCode, Version: base.Version,
		Members: make([]apigen.ClusterMember, 0, len(rows)),
	}
	for _, r := range rows {
		mem := apigen.ClusterMember{
			Id: uuid.UUID(r.ID.Bytes), Hostname: r.Hostname, Type: apigen.DeviceType(r.Type), Model: r.Model,
			SerialNumber: r.SerialNumber, Lifecycle: apigen.DeviceLifecycle(r.Lifecycle), MemberNo: optInt(r.ClusterMemberNo),
		}
		if r.ClusterRole.Valid {
			role := apigen.ClusterRole(r.ClusterRole.String)
			mem.Role = &role
		}
		out.Members = append(out.Members, mem)
	}
	return out, nil
}

type clusterFields struct {
	kind, name, hostname, notes string
	mgmt                        *netip.Prefix
	site                        uuid.UUID
	unit                        *uuid.UUID
}

func validateCluster(kind apigen.ClusterKind, name string, hostname, mgmtIP, notes *string, site uuid.UUID, unit *uuid.UUID) (clusterFields, string) {
	f := clusterFields{
		kind: string(kind), name: strings.TrimSpace(name), hostname: strings.TrimSpace(str(hostname)), notes: str(notes),
		site: site, unit: unit,
	}
	switch {
	case !kind.Valid():
		return f, "Kiểu cụm không hợp lệ"
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên cụm bắt buộc, tối đa 100 ký tự"
	case f.hostname != "" && (tooLong(f.hostname, 253) || !hostnameRe.MatchString(f.hostname)):
		return f, "Hostname cụm: chữ, số, dấu chấm, gạch ngang, gạch dưới"
	case tooLong(f.notes, 2000):
		return f, "Ghi chú tối đa 2000 ký tự"
	}
	if mgmtIP != nil && strings.TrimSpace(*mgmtIP) != "" {
		p, ok := parseCIDR(*mgmtIP)
		if !ok {
			return f, "IP quản trị cụm không hợp lệ, vd 10.72.114.1/24"
		}
		f.mgmt = &p
	}
	return f, ""
}

type clusterSnapshot struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Hostname string `json:"hostname,omitempty"`
	MgmtIP   string `json:"mgmtIp,omitempty"`
	Site     string `json:"site"`
	Unit     string `json:"unit"`
}

func snapCluster(c store.GetClusterRow) clusterSnapshot {
	ip := ""
	if c.MgmtIp != nil {
		ip = c.MgmtIp.String()
	}
	return clusterSnapshot{c.Kind, c.Name, c.Hostname, ip, c.SiteCode, c.PartnerCode + " › " + c.UnitCode}
}

func (s *Server) ListClusters(ctx context.Context, req apigen.ListClustersRequestObject) (apigen.ListClustersResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	v := visibilityOf(m)
	params := store.ListClustersParams{
		OrganizationID: m.OrgID, Restricted: v.restricted, GrantUnits: v.grantUnits, GrantPartners: v.grantPartners,
		SharePartners: v.sharePts,
	}
	if req.Params.SiteId != nil {
		params.SiteFilter = pgUUID(*req.Params.SiteId)
	}
	rows, err := s.q.ListClusters(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list clusters: %w", err)
	}
	out := apigen.ClusterList{Clusters: make([]apigen.Cluster, 0, len(rows))}
	for _, r := range rows {
		c := store.GetClusterRow(r)
		level, err := clusterLevel(ctx, s.q, m, c)
		if err != nil {
			return nil, err
		}
		out.Clusters = append(out.Clusters, toCluster(c, level))
	}
	return apigen.ListClusters200JSONResponse(out), nil
}

func (s *Server) GetCluster(ctx context.Context, req apigen.GetClusterRequestObject) (apigen.GetClusterResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	c, ok, err := loadCluster(ctx, s.q, m, req.ClusterId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetCluster404JSONResponse{NotFoundJSONResponse: notFoundBody(msgClusterNotFound)}, nil
	}
	out, err := s.clusterDetail(ctx, s.q, m, c)
	if err != nil {
		return nil, err
	}
	return apigen.GetCluster200JSONResponse(out), nil
}

// saveCluster creates (id nil) or updates a cluster in one transaction.
func (s *Server) saveCluster(ctx context.Context, m tenant.Membership, f clusterFields, id *uuid.UUID, version int32) (apigen.ClusterDetail, writeOutcome, error) {
	var (
		out    writeOutcome
		detail apigen.ClusterDetail
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		var before store.GetClusterRow
		keep := pgtype.UUID{}
		if id != nil {
			var ok bool
			var err error
			if before, ok, err = loadCluster(ctx, q, m, *id); err != nil {
				return err
			}
			if !ok {
				out.gone = true
				return errRollback
			}
			if level, err := clusterLevel(ctx, q, m, before); err != nil {
				return err
			} else if level < tenant.LevelEdit {
				out.code = 403
				return errRollback
			}
			keep = before.BusinessUnitID
		}
		// Same owner rule as devices: the site's unit, or a chosen unit in a shared site (ADR-026).
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
		if id != nil && f.kind != before.Kind && before.MemberCount > 0 {
			members, err := q.ListClusterMembers(ctx, store.ListClusterMembersParams{OrganizationID: m.OrgID, ClusterID: before.ID})
			if err != nil {
				return fmt.Errorf("list members: %w", err)
			}
			for _, mb := range members {
				if !clusterFits(f.kind, mb.Type) {
					out.bad = fmt.Sprintf("Không đổi được sang kiểu %s: thành viên %s không phù hợp", clusterKindLabels[f.kind], mb.Hostname)
					return errRollback
				}
			}
		}
		if id != nil && moved && before.MemberCount > 0 {
			out.bad = "Cụm còn thành viên: không đổi site/đơn vị được (thành viên phải cùng site và đơn vị với cụm)"
			return errRollback
		}
		var cid pgtype.UUID
		if id == nil {
			cid, err = q.CreateCluster(ctx, store.CreateClusterParams{
				OrganizationID: m.OrgID, BusinessUnitID: p.unit, SiteID: p.site.ID, Kind: f.kind, Name: f.name,
				Hostname: f.hostname, MgmtIp: f.mgmt, Notes: f.notes,
			})
		} else {
			cid = before.ID
			var n int64
			n, err = q.UpdateCluster(ctx, store.UpdateClusterParams{
				ID: before.ID, OrganizationID: m.OrgID, Version: version, BusinessUnitID: p.unit, SiteID: p.site.ID,
				Kind: f.kind, Name: f.name, Hostname: f.hostname, MgmtIp: f.mgmt, Notes: f.notes,
			})
			if err == nil && n == 0 {
				out.conf = msgStale
				return errRollback
			}
		}
		if isUniqueViolation(err) {
			out.conf = "Tên cụm đã tồn tại trong tổ chức"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save cluster: %w", err)
		}
		after, ok, err := loadCluster(ctx, q, m, uuid.UUID(cid.Bytes))
		if err != nil || !ok {
			out.code = 403
			return orRollback(err)
		}
		entry := audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "cluster.create", ObjectType: "device_cluster",
			ObjectID: uuidStr(cid), After: snapCluster(after), Meta: infoFrom(ctx).meta,
		}
		if id != nil {
			entry.Action, entry.Before = "cluster.update", snapCluster(before)
		}
		if err := audit.Write(ctx, q, entry); err != nil {
			return err
		}
		detail, err = s.clusterDetail(ctx, q, m, after)
		return err
	})
	return detail, out, err
}

func (s *Server) CreateCluster(ctx context.Context, req apigen.CreateClusterRequestObject) (apigen.CreateClusterResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateCluster(b.Kind, b.Name, b.Hostname, b.MgmtIp, b.Notes, b.SiteId, b.BusinessUnitId)
	if msg != "" {
		return apigen.CreateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	detail, out, err := s.saveCluster(ctx, m, f, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.CreateCluster403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.CreateCluster409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.CreateCluster201JSONResponse(detail), nil
}

func (s *Server) UpdateCluster(ctx context.Context, req apigen.UpdateClusterRequestObject) (apigen.UpdateClusterResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateCluster(b.Kind, b.Name, b.Hostname, b.MgmtIp, b.Notes, b.SiteId, b.BusinessUnitId)
	if msg != "" {
		if _, ok, err := loadCluster(ctx, s.q, m, req.ClusterId); err != nil {
			return nil, err
		} else if !ok {
			return apigen.UpdateCluster404JSONResponse{NotFoundJSONResponse: notFoundBody(msgClusterNotFound)}, nil
		}
		return apigen.UpdateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := req.ClusterId
	detail, out, err := s.saveCluster(ctx, m, f, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.gone:
		return apigen.UpdateCluster404JSONResponse{NotFoundJSONResponse: notFoundBody(msgClusterNotFound)}, nil
	case out.code == 403:
		return apigen.UpdateCluster403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.UpdateCluster400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.UpdateCluster409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.UpdateCluster200JSONResponse(detail), nil
}

func (s *Server) DeleteCluster(ctx context.Context, req apigen.DeleteClusterRequestObject) (apigen.DeleteClusterResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		c, ok, err := loadCluster(ctx, q, m, req.ClusterId)
		if err != nil {
			return err
		}
		if !ok {
			out.gone = true
			return errRollback
		}
		if m.UnitLevel(c.BusinessUnitID, c.PartnerID) < tenant.LevelEdit {
			out.code = 403
			return errRollback
		}
		// Members may share a hostname only inside the cluster: they leave it one by one (renaming if needed).
		if c.MemberCount > 0 {
			out.conf = fmt.Sprintf("Cụm còn %d thành viên — gỡ thành viên khỏi cụm trước", c.MemberCount)
			return errRollback
		}
		if _, err := q.DeleteCluster(ctx, store.DeleteClusterParams{ID: c.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete cluster: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "cluster.delete", ObjectType: "device_cluster",
			ObjectID: uuidStr(c.ID), Before: snapCluster(c), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case out.gone:
		return apigen.DeleteCluster404JSONResponse{NotFoundJSONResponse: notFoundBody(msgClusterNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteCluster403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.DeleteCluster409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteCluster204Response{}, nil
}
