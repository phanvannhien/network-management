package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Diagrams (P1-13, ADR-015/032): a view over the inventory owned by the organization. The editor saves the view and
// its inventory changes in one transaction under an optimistic lock. References to objects that no longer exist are
// reported as hidden refs and kept until the user removes them.

const (
	msgDiagramNotFound = "Không tìm thấy sơ đồ"
	msgDiagramStale    = "Sơ đồ đã được người khác lưu sau khi bạn mở — tải lại để xem bản mới (nháp của bạn vẫn được giữ)"
	maxNodes           = 5000
	maxEdges           = 10000
	maxAnnotations     = 2000
	maxChanges         = 2000
	maxCoord           = 1e7
)

func diagramLevel(_ context.Context, _ store.Querier, m tenant.Membership, _ store.ListDiagramsRow) (int, error) {
	return m.Level(), nil // diagrams belong to the organization (ADR-032)
}

func toDiagram(d store.ListDiagramsRow, level int) apigen.Diagram {
	return apigen.Diagram{
		Id: uuid.UUID(d.ID.Bytes), Name: d.Name, Layer: apigen.DiagramLayer(d.Layer), Description: d.Description,
		NodeCount: d.NodeCount, UpdatedAt: d.UpdatedAt.Time, Access: levelName(level), Version: d.Version,
	}
}

func loadDiagram(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.ListDiagramsRow, int, bool, error) {
	rows, err := q.ListDiagrams(ctx, store.ListDiagramsParams{OrganizationID: m.OrgID, DiagramID: pgUUID(id)})
	if err != nil {
		return store.ListDiagramsRow{}, 0, false, fmt.Errorf("load diagram: %w", err)
	}
	if len(rows) == 0 {
		return store.ListDiagramsRow{}, 0, false, nil
	}
	level, err := diagramLevel(ctx, q, m, rows[0])
	if err != nil || level == tenant.LevelNone {
		return rows[0], 0, false, err
	}
	return rows[0], level, true, nil
}

func storedView(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (apigen.DiagramView, error) {
	raw, err := q.GetDiagramView(ctx, store.GetDiagramViewParams{ID: id, OrganizationID: m.OrgID})
	if err != nil {
		return apigen.DiagramView{}, fmt.Errorf("load view: %w", err)
	}
	v := apigen.DiagramView{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &v); err != nil {
			return v, fmt.Errorf("decode view: %w", err)
		}
	}
	if v.Nodes == nil {
		v.Nodes = []apigen.DiagramNode{}
	}
	if v.Edges == nil {
		v.Edges = []apigen.DiagramEdge{}
	}
	if v.Annotations == nil {
		v.Annotations = []apigen.DiagramAnnotation{}
	}
	return v, nil
}

// refChecker answers whether the caller may see an object referenced by a view (cached per request).
type refChecker struct {
	ctx  context.Context
	q    store.Querier
	m    tenant.Membership
	seen map[string]bool
}

func newRefChecker(ctx context.Context, q store.Querier, m tenant.Membership) *refChecker {
	return &refChecker{ctx: ctx, q: q, m: m, seen: map[string]bool{}}
}

func (c *refChecker) visible(kind string, id uuid.UUID) (bool, error) {
	key := kind + "/" + id.String()
	if v, ok := c.seen[key]; ok {
		return v, nil
	}
	var ok bool
	var err error
	switch kind {
	case "device":
		_, ok, err = loadDevice(c.ctx, c.q, c.m, id)
	case "endpoint_group":
		_, ok, err = loadGroup(c.ctx, c.q, c.m, id)
	case "site":
		_, ok, err = loadSite(c.ctx, c.q, c.m, id)
	case "diagram":
		_, _, ok, err = loadDiagram(c.ctx, c.q, c.m, id)
	case "link":
		_, _, ok, err = loadLink(c.ctx, c.q, c.m, pgUUID(id))
	case "subnet":
		_, ok, err = loadSubnet(c.ctx, c.q, c.m, id)
	case "segment":
		_, err = c.q.GetSegment(c.ctx, store.GetSegmentParams{OrganizationID: c.m.OrgID, ID: pgUUID(id)})
		if ok = err == nil; errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
	}
	if err != nil {
		return false, err
	}
	c.seen[key] = ok
	return ok, nil
}

// diagramDetail resolves the view: devices, endpoint groups and links the caller sees; the rest are hidden refs.
func (s *Server) diagramDetail(ctx context.Context, q store.Querier, m tenant.Membership, d store.ListDiagramsRow, level int) (apigen.DiagramDetail, error) {
	view, err := storedView(ctx, q, m, d.ID)
	if err != nil {
		return apigen.DiagramDetail{}, err
	}
	out := apigen.DiagramDetail{Diagram: toDiagram(d, level), View: view, Devices: []apigen.Device{},
		EndpointGroups: []apigen.EndpointGroup{}, Links: []apigen.Link{}, HiddenRefs: []uuid.UUID{}}
	var deviceIDs, endIDs, segIDs []pgtype.UUID
	hidden := map[uuid.UUID]bool{}
	check := newRefChecker(ctx, q, m)
	for _, n := range view.Nodes {
		switch n.RefKind {
		case apigen.DiagramNodeRefKindDevice:
			deviceIDs = append(deviceIDs, pgUUID(n.RefId))
		case apigen.DiagramNodeRefKindEndpointGroup:
			g, ok, err := loadGroup(ctx, q, m, n.RefId)
			if err != nil {
				return out, err
			}
			if !ok {
				hidden[n.RefId] = true
				continue
			}
			lv, err := groupLevel(ctx, q, m, g)
			if err != nil {
				return out, err
			}
			out.EndpointGroups = append(out.EndpointGroups, toGroup(g, lv))
			endIDs = append(endIDs, g.ID)
		case apigen.DiagramNodeRefKindSegment:
			// A shared network (P2-08): its cables to devices on the view are drawn like any other.
			if ok, err := check.visible("segment", n.RefId); err != nil {
				return out, err
			} else if !ok {
				hidden[n.RefId] = true
				continue
			}
			endIDs = append(endIDs, pgUUID(n.RefId))
			segIDs = append(segIDs, pgUUID(n.RefId))
		default:
			if ok, err := check.visible(string(n.RefKind), n.RefId); err != nil {
				return out, err
			} else if !ok {
				hidden[n.RefId] = true
			}
		}
	}
	if len(deviceIDs) > 0 {
		rows, err := q.ListDevicesByIDs(ctx, store.ListDevicesByIDsParams{Ids: deviceIDs, OrganizationID: m.OrgID})
		if err != nil {
			return out, fmt.Errorf("diagram devices: %w", err)
		}
		devs := make([]store.GetDeviceRow, len(rows))
		found := map[pgtype.UUID]bool{}
		for i, r := range rows {
			devs[i] = store.GetDeviceRow(r)
			found[r.ID] = true
			endIDs = append(endIDs, r.ID)
		}
		levels, err := deviceLevels(ctx, q, m, devs)
		if err != nil {
			return out, err
		}
		for _, dv := range devs {
			out.Devices = append(out.Devices, toDevice(dv, levels[dv.ID]))
		}
		for _, id := range deviceIDs {
			if !found[id] {
				hidden[uuid.UUID(id.Bytes)] = true
			}
		}
	}
	// Links between nodes of the view, plus those its edges name.
	linkIDs := []pgtype.UUID{}
	if len(endIDs) > 0 {
		if linkIDs, err = q.ListLinkIDsAmong(ctx, store.ListLinkIDsAmongParams{OrganizationID: m.OrgID, Ids: endIDs}); err != nil {
			return out, fmt.Errorf("diagram links: %w", err)
		}
	}
	for _, e := range view.Edges {
		linkIDs = append(linkIDs, pgUUID(e.LinkId))
	}
	if len(linkIDs) > 0 {
		rows, err := q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, LinkIds: linkIDs})
		if err != nil {
			return out, fmt.Errorf("diagram links: %w", err)
		}
		if out.Links, err = visibleLinks(ctx, q, m, rows); err != nil {
			return out, err
		}
		shown := map[uuid.UUID]bool{}
		for _, l := range out.Links {
			shown[l.Id] = true
		}
		for _, e := range view.Edges {
			if !shown[e.LinkId] {
				hidden[e.LinkId] = true
			}
		}
	}
	for id := range hidden {
		out.HiddenRefs = append(out.HiddenRefs, id)
	}
	if err := diagramL2(ctx, q, m, &out); err != nil {
		return out, err
	}
	if err := diagramExternal(ctx, q, m, d.ID, endIDs, &out); err != nil {
		return out, err
	}
	if err := diagramL3(ctx, q, m, &out); err != nil {
		return out, err
	}
	segments := []apigen.Segment{}
	if len(segIDs) > 0 {
		if segments, err = listSegments(ctx, q, m, segIDs); err != nil {
			return out, err
		}
	}
	out.Segments = &segments
	return out, nil
}

// diagramL3 adds what L3 pages (P2-08, ADR-047) draw, all derived from IPAM: where each device's interface IPs sit
// (subnet, gateway), the subnet of each endpoint group, and those subnets plus the ones placed as bars.
func diagramL3(ctx context.Context, q store.Querier, m tenant.Membership, out *apigen.DiagramDetail) error {
	l3 := apigen.DiagramL3{Subnets: []apigen.DiagramSubnet{}, Attachments: []apigen.DiagramAttachment{},
		Groups: []struct {
			GroupId  openapi_types.UUID `json:"groupId"`
			SubnetId openapi_types.UUID `json:"subnetId"`
		}{}}
	out.L3 = &l3
	subnetIDs := []pgtype.UUID{}
	seen := map[pgtype.UUID]bool{}
	want := func(id pgtype.UUID) {
		if id.Valid && !seen[id] {
			seen[id] = true
			subnetIDs = append(subnetIDs, id)
		}
	}
	devIDs := make([]pgtype.UUID, 0, len(out.Devices))
	for _, d := range out.Devices {
		devIDs = append(devIDs, pgUUID(d.Id))
	}
	if len(devIDs) > 0 {
		rows, err := q.DiagramL3Attachments(ctx, store.DiagramL3AttachmentsParams{OrganizationID: m.OrgID, DeviceIds: devIDs})
		if err != nil {
			return fmt.Errorf("l3 attachments: %w", err)
		}
		for _, r := range rows {
			want(r.SubnetID)
			l3.Attachments = append(l3.Attachments, apigen.DiagramAttachment{DeviceId: uuid.UUID(r.DeviceID.Bytes),
				InterfaceName: r.InterfaceName, InterfaceKind: r.InterfaceKind, Address: r.Address,
				SubnetId: optUUID(r.SubnetID), IsGateway: r.IsGateway})
		}
	}
	groupIDs := make([]pgtype.UUID, 0, len(out.EndpointGroups))
	for _, g := range out.EndpointGroups {
		groupIDs = append(groupIDs, pgUUID(g.Id))
	}
	if len(groupIDs) > 0 {
		rows, err := q.DiagramL3Groups(ctx, store.DiagramL3GroupsParams{OrganizationID: m.OrgID, GroupIds: groupIDs})
		if err != nil {
			return fmt.Errorf("l3 groups: %w", err)
		}
		for _, r := range rows {
			want(r.SubnetID)
			l3.Groups = append(l3.Groups, struct {
				GroupId  openapi_types.UUID `json:"groupId"`
				SubnetId openapi_types.UUID `json:"subnetId"`
			}{uuid.UUID(r.GroupID.Bytes), uuid.UUID(r.SubnetID.Bytes)})
		}
	}
	for _, n := range out.View.Nodes {
		if n.RefKind == apigen.DiagramNodeRefKindSubnet {
			want(pgUUID(n.RefId))
		}
	}
	if len(subnetIDs) == 0 {
		return nil
	}
	rows, err := q.DiagramSubnets(ctx, store.DiagramSubnetsParams{OrganizationID: m.OrgID, Ids: subnetIDs})
	if err != nil {
		return fmt.Errorf("l3 subnets: %w", err)
	}
	for _, r := range rows {
		l3.Subnets = append(l3.Subnets, apigen.DiagramSubnet{Id: uuid.UUID(r.ID.Bytes), Cidr: r.Cidr, Vrf: r.Vrf, Gateway: r.Gateway,
			Description: r.Description, SiteId: optUUID(r.SiteID), Vid: optInt(r.Vid), VlanName: r.VlanName, VlanColor: r.VlanColor})
	}
	return nil
}

// diagramExternal adds what off-page connectors (P2-08, ADR-047) need: the links with one end on the diagram and the
// other diagrams — those the caller may open — that place their far ends.
func diagramExternal(ctx context.Context, q store.Querier, m tenant.Membership, self pgtype.UUID, endIDs []pgtype.UUID,
	out *apigen.DiagramDetail) error {
	ext, elsewhere := []apigen.Link{}, []apigen.DiagramElsewhere{}
	out.ExternalLinks, out.Elsewhere = &ext, &elsewhere
	if len(endIDs) == 0 {
		return nil
	}
	ids, err := q.ListLinkIDsTouching(ctx, store.ListLinkIDsTouchingParams{OrganizationID: m.OrgID, Ids: endIDs})
	if err != nil || len(ids) == 0 {
		if err != nil {
			return fmt.Errorf("external links: %w", err)
		}
		return nil
	}
	rows, err := q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, LinkIds: ids})
	if err != nil {
		return fmt.Errorf("external links: %w", err)
	}
	if ext, err = visibleLinks(ctx, q, m, rows); err != nil {
		return err
	}
	out.ExternalLinks = &ext
	onView := map[uuid.UUID]bool{}
	for _, id := range endIDs {
		onView[uuid.UUID(id.Bytes)] = true
	}
	far := []string{}
	seen := map[uuid.UUID]bool{}
	for _, l := range ext {
		for _, e := range []apigen.LinkEnd{l.A, l.B} {
			if !onView[e.Id] && !seen[e.Id] {
				seen[e.Id] = true
				far = append(far, e.Id.String())
			}
		}
	}
	if len(far) == 0 {
		return nil
	}
	shows, err := q.ListDiagramsShowing(ctx, store.ListDiagramsShowingParams{OrganizationID: m.OrgID, Ids: far})
	if err != nil {
		return fmt.Errorf("far end diagrams: %w", err)
	}
	all, err := q.ListDiagrams(ctx, store.ListDiagramsParams{OrganizationID: m.OrgID})
	if err != nil {
		return fmt.Errorf("list diagrams: %w", err)
	}
	byID := map[pgtype.UUID]store.ListDiagramsRow{}
	for _, d := range all {
		byID[d.ID] = d
	}
	where := map[string][]apigen.DiagramRef{}
	for _, sh := range shows {
		d, ok := byID[sh.ID]
		if !ok || sh.ID == self {
			continue
		}
		if lv, err := diagramLevel(ctx, q, m, d); err != nil {
			return err
		} else if lv == tenant.LevelNone {
			continue
		}
		for _, ref := range sh.RefIds {
			where[ref] = append(where[ref], apigen.DiagramRef{Id: uuid.UUID(sh.ID.Bytes), Name: sh.Name})
		}
	}
	for _, ref := range far {
		if ds := where[ref]; len(ds) > 0 {
			elsewhere = append(elsewhere, apigen.DiagramElsewhere{RefId: uuid.MustParse(ref), Diagrams: ds})
		}
	}
	out.Elsewhere = &elsewhere
	return nil
}

// diagramL2 adds what the L2 view (P2-08, ADR-047) colours and marks with: the VLANs of the sites on the view (plus
// the organization-wide ones) and where each VLAN is routed (a device holding its subnet's gateway IP).
func diagramL2(ctx context.Context, q store.Querier, m tenant.Membership, out *apigen.DiagramDetail) error {
	siteIDs, deviceIDs := []pgtype.UUID{}, []pgtype.UUID{}
	seen := map[uuid.UUID]bool{}
	addSite := func(id uuid.UUID) {
		if !seen[id] {
			seen[id] = true
			siteIDs = append(siteIDs, pgUUID(id))
		}
	}
	for _, d := range out.Devices {
		addSite(d.SiteId)
		deviceIDs = append(deviceIDs, pgUUID(d.Id))
	}
	for _, g := range out.EndpointGroups {
		addSite(g.SiteId)
	}
	vlans, err := q.DiagramVlans(ctx, store.DiagramVlansParams{OrganizationID: m.OrgID, SiteIds: siteIDs})
	if err != nil {
		return fmt.Errorf("diagram vlans: %w", err)
	}
	outVlans := make([]apigen.DiagramVlan, 0, len(vlans))
	for _, v := range vlans {
		outVlans = append(outVlans, apigen.DiagramVlan{Vid: v.Vid, Name: v.Name, Color: v.Color, SiteId: optUUID(v.SiteID)})
	}
	out.Vlans = &outVlans
	outGws := []apigen.DiagramGateway{}
	if len(deviceIDs) > 0 {
		gws, err := q.DiagramGateways(ctx, store.DiagramGatewaysParams{OrganizationID: m.OrgID, DeviceIds: deviceIDs})
		if err != nil {
			return fmt.Errorf("diagram gateways: %w", err)
		}
		for _, g := range gws {
			outGws = append(outGws, apigen.DiagramGateway{DeviceId: uuid.UUID(g.DeviceID.Bytes), Vid: g.Vid, SiteId: optUUID(g.SiteID),
				Address: g.Address, InterfaceName: g.InterfaceName})
		}
	}
	out.Gateways = &outGws
	return nil
}

func (s *Server) ListDiagrams(ctx context.Context, req apigen.ListDiagramsRequestObject) (apigen.ListDiagramsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListDiagrams(ctx, store.ListDiagramsParams{OrganizationID: m.OrgID})
	if err != nil {
		return nil, fmt.Errorf("list diagrams: %w", err)
	}
	out := apigen.DiagramList{Diagrams: []apigen.Diagram{}}
	for _, d := range rows {
		level, err := diagramLevel(ctx, s.q, m, d)
		if err != nil {
			return nil, err
		}
		if level > tenant.LevelNone {
			out.Diagrams = append(out.Diagrams, toDiagram(d, level))
		}
	}
	return apigen.ListDiagrams200JSONResponse(out), nil
}

func (s *Server) GetDiagram(ctx context.Context, req apigen.GetDiagramRequestObject) (apigen.GetDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, level, ok, err := loadDiagram(ctx, s.q, m, req.DiagramId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetDiagram404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
	}
	detail, err := s.diagramDetail(ctx, s.q, m, d, level)
	if err != nil {
		return nil, err
	}
	return apigen.GetDiagram200JSONResponse(detail), nil
}

type diagramSnapshot struct {
	Name  string `json:"name"`
	Layer string `json:"layer"`
}

func snapDiagram(d store.ListDiagramsRow) diagramSnapshot { return diagramSnapshot{d.Name, d.Layer} }

func (s *Server) CreateDiagram(ctx context.Context, req apigen.CreateDiagramRequestObject) (apigen.CreateDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	bad := func(msg string) (apigen.CreateDiagramResponseObject, error) {
		return apigen.CreateDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	if !m.CanEdit() {
		return apigen.CreateDiagram403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	if b == nil {
		return bad("Thiếu dữ liệu")
	}
	name, layer, desc := strings.TrimSpace(b.Name), "physical", str(b.Description)
	if b.Layer != nil {
		layer = string(*b.Layer)
	}
	switch {
	case name == "" || tooLong(name, 120):
		return bad("Tên sơ đồ bắt buộc, tối đa 120 ký tự")
	case !apigen.DiagramLayer(layer).Valid():
		return bad("Lớp sơ đồ không hợp lệ")
	case tooLong(desc, 1000):
		return bad("Mô tả tối đa 1000 ký tự")
	}
	var (
		detail   apigen.DiagramDetail
		conflict bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		id, err := q.CreateDiagram(ctx, store.CreateDiagramParams{OrganizationID: m.OrgID, Name: name, Layer: layer, Description: desc,
			CreatedBy: pgUUID(uuid.UUID(m.UserID.Bytes))})
		if isUniqueViolation(err) {
			conflict = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create diagram: %w", err)
		}
		d, lv, ok, err := loadDiagram(ctx, q, m, uuid.UUID(id.Bytes))
		if err != nil || !ok {
			return orRollback(err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "diagram.create", ObjectType: "diagram",
			ObjectID: uuidStr(id), After: snapDiagram(d), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		detail, err = s.diagramDetail(ctx, q, m, d, lv)
		return err
	})
	switch {
	case err != nil:
		return nil, err
	case conflict:
		return apigen.CreateDiagram409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: fmt.Sprintf("Đã có sơ đồ tên %s", name)}}, nil
	}
	return apigen.CreateDiagram201JSONResponse(detail), nil
}

func (s *Server) UpdateDiagram(ctx context.Context, req apigen.UpdateDiagramRequestObject) (apigen.UpdateDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	d, level, ok, err := loadDiagram(ctx, s.q, m, req.DiagramId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.UpdateDiagram404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
	}
	if level < tenant.LevelEdit {
		return apigen.UpdateDiagram403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	name, layer, desc := strings.TrimSpace(b.Name), d.Layer, str(b.Description)
	if b.Layer != nil {
		layer = string(*b.Layer)
	}
	if name == "" || tooLong(name, 120) || tooLong(desc, 1000) || !apigen.DiagramLayer(layer).Valid() {
		return apigen.UpdateDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Tên (≤120), lớp hoặc mô tả (≤1000) không hợp lệ"}}, nil
	}
	var conf string
	var after store.ListDiagramsRow
	err = s.withTx(ctx, func(q store.Querier) error {
		n, err := q.UpdateDiagramMeta(ctx, store.UpdateDiagramMetaParams{ID: d.ID, OrganizationID: m.OrgID, Version: b.Version, Name: name, Layer: layer, Description: desc})
		if isUniqueViolation(err) {
			conf = fmt.Sprintf("Đã có sơ đồ tên %s", name)
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update diagram: %w", err)
		}
		if n == 0 {
			conf = msgStale
			return errRollback
		}
		if after, _, _, err = loadDiagram(ctx, q, m, req.DiagramId); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "diagram.update", ObjectType: "diagram",
			ObjectID: uuidStr(d.ID), Before: snapDiagram(d), After: snapDiagram(after), Meta: infoFrom(ctx).meta})
	})
	switch {
	case err != nil:
		return nil, err
	case conf != "":
		return apigen.UpdateDiagram409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conf}}, nil
	}
	return apigen.UpdateDiagram200JSONResponse(toDiagram(after, level)), nil
}

func (s *Server) DeleteDiagram(ctx context.Context, req apigen.DeleteDiagramRequestObject) (apigen.DeleteDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, level, ok, err := loadDiagram(ctx, s.q, m, req.DiagramId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.DeleteDiagram404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
	}
	if level < tenant.LevelEdit {
		return apigen.DeleteDiagram403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	err = s.withTx(ctx, func(q store.Querier) error {
		if _, err := q.DeleteDiagram(ctx, store.DeleteDiagramParams{ID: d.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete diagram: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "diagram.delete", ObjectType: "diagram",
			ObjectID: uuidStr(d.ID), Before: snapDiagram(d), Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	return apigen.DeleteDiagram204Response{}, nil
}

// --- save ---

func finite(vals ...float32) bool {
	for _, v := range vals {
		f := float64(v)
		if math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > maxCoord {
			return false
		}
	}
	return true
}

// checkViewShape enforces sizes, unique ids and sane numbers (the schema limits are not enforced by the router).
func checkViewShape(v apigen.DiagramView) string {
	if len(v.Nodes) > maxNodes || len(v.Edges) > maxEdges || len(v.Annotations) > maxAnnotations {
		return fmt.Sprintf("Sơ đồ tối đa %d node, %d cạnh, %d chú thích", maxNodes, maxEdges, maxAnnotations)
	}
	if v.PortStyle != nil && !v.PortStyle.Valid() {
		return "Kiểu ký hiệu cổng không hợp lệ"
	}
	ids := map[string]bool{}
	unique := func(id string) bool {
		if id == "" || len(id) > 64 || ids[id] {
			return false
		}
		ids[id] = true
		return true
	}
	for _, n := range v.Nodes {
		if !unique(n.Id) || !n.RefKind.Valid() || !finite(n.X, n.Y) {
			return "Node trên sơ đồ không hợp lệ (id trùng/trống, loại hoặc tọa độ sai)"
		}
		if n.LabelStyle != nil {
			if c, ok := (*n.LabelStyle)["color"]; ok && !validColor(c) {
				return "Màu nhãn không hợp lệ (màu có sẵn hoặc #rrggbb)"
			}
		}
	}
	for _, e := range v.Edges {
		if !unique(e.Id) || (e.Routing != nil && !e.Routing.Valid()) || (e.Waypoints != nil && len(*e.Waypoints) > 50) {
			return "Cạnh trên sơ đồ không hợp lệ"
		}
		for _, p := range ptrSlice(e.Waypoints) {
			if !finite(p.X, p.Y) {
				return "Điểm uốn của cạnh không hợp lệ"
			}
		}
	}
	for _, a := range v.Annotations {
		if !unique(a.Id) || !a.Kind.Valid() || !finite(a.X, a.Y) || (a.Text != nil && len(*a.Text) > 2000) {
			return "Chú thích trên sơ đồ không hợp lệ"
		}
		size := func(p *float32) bool { return p == nil || (finite(*p, 0) && *p >= 0 && *p <= 20000) }
		switch {
		case !size(a.Width) || !size(a.Height):
			return "Kích thước khung/chú thích không hợp lệ"
		case a.FontSize != nil && (*a.FontSize < 8 || *a.FontSize > 96):
			return "Cỡ chữ từ 8 đến 96"
		case a.Color != nil && !validColor(*a.Color):
			return "Màu chú thích không hợp lệ"
		case a.LineStyle != nil && !a.LineStyle.Valid():
			return "Kiểu nét mũi tên không hợp lệ"
		case (a.SiteId != nil || a.LocationId != nil) && a.Kind != apigen.DiagramAnnotationKindZone:
			return "Chỉ khung (zone) mới gắn được site/location"
		case a.LocationId != nil && a.SiteId == nil:
			return "Khung gắn location phải gắn cả site"
		}
		for _, p := range ptrSlice(a.Points) {
			if !finite(p.X, p.Y) {
				return "Điểm của chú thích không hợp lệ"
			}
		}
	}
	if v.Viewport != nil && (!finite(v.Viewport.X, v.Viewport.Y) || v.Viewport.Zoom < 0.05 || v.Viewport.Zoom > 10) {
		return "Viewport không hợp lệ"
	}
	if v.LabelTemplate != nil && len(*v.LabelTemplate) > 200 {
		return "Mẫu nhãn tối đa 200 ký tự"
	}
	return checkPages(v)
}

// maxPages bounds the tabs of one diagram (P2-08).
const maxPages = 50

// checkPages: pages have unique ids, a name and a layer; everything on the view names an existing page (or none = the
// first page); an object is placed at most once per page.
func checkPages(v apigen.DiagramView) string {
	pages := ptrSlice(v.Pages)
	if len(pages) > maxPages {
		return fmt.Sprintf("Sơ đồ tối đa %d trang", maxPages)
	}
	known := map[string]bool{}
	for _, p := range pages {
		name := strings.TrimSpace(p.Name)
		if p.Id == "" || len(p.Id) > 64 || known[p.Id] || name == "" || utf8.RuneCountInString(name) > 80 || !p.Layer.Valid() {
			return "Trang không hợp lệ (id trùng/trống, tên 1–80 ký tự, lớp physical / l2 / l3)"
		}
		known[p.Id] = true
	}
	first := ""
	if len(pages) > 0 {
		first = pages[0].Id
	}
	page := func(id *string) (string, bool) {
		if id == nil || *id == "" {
			return first, true
		}
		return *id, known[*id]
	}
	placed := map[string]bool{}
	for _, n := range v.Nodes {
		pid, ok := page(n.PageId)
		if !ok {
			return "Node nằm trên trang không tồn tại"
		}
		key := pid + "|" + string(n.RefKind) + "|" + n.RefId.String()
		if placed[key] {
			return "Một đối tượng chỉ đặt một lần trên mỗi trang"
		}
		placed[key] = true
	}
	for _, e := range v.Edges {
		if _, ok := page(e.PageId); !ok {
			return "Cạnh nằm trên trang không tồn tại"
		}
	}
	for _, a := range v.Annotations {
		if _, ok := page(a.PageId); !ok {
			return "Chú thích nằm trên trang không tồn tại"
		}
	}
	stubs := ptrSlice(v.Stubs)
	if len(stubs) > 2000 {
		return "Sơ đồ tối đa 2000 vị trí connector"
	}
	for _, st := range stubs {
		if _, ok := page(st.PageId); !ok || st.Key == "" || len(st.Key) > 200 || !finite(st.X, st.Y) {
			return "Vị trí connector không hợp lệ"
		}
	}
	return ""
}

func ptrSlice[T any](p *[]T) []T {
	if p == nil {
		return nil
	}
	return *p
}

type saveOutcome struct {
	bad, conf string
	code      int
}

func (s *Server) SaveDiagram(ctx context.Context, req apigen.SaveDiagramRequestObject) (apigen.SaveDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.SaveDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	changes := ptrSlice(b.Changes)
	var (
		out    saveOutcome
		result apigen.DiagramSaveResult
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		d, level, ok, err := loadDiagram(ctx, q, m, req.DiagramId)
		if err != nil {
			return err
		}
		if !ok {
			out.code = 404
			return errRollback
		}
		if level < tenant.LevelEdit {
			out.code = 403
			return errRollback
		}
		if d.Version != b.Version {
			out.conf = msgDiagramStale
			return errRollback
		}
		if msg := checkViewShape(b.View); msg != "" {
			out.bad = msg
			return errRollback
		}
		if len(changes) > maxChanges {
			out.bad = fmt.Sprintf("Tối đa %d thay đổi mỗi lần lưu", maxChanges)
			return errRollback
		}
		idMap := map[uuid.UUID]uuid.UUID{}
		mapID := func(id uuid.UUID) uuid.UUID {
			if real, ok := idMap[id]; ok {
				return real
			}
			return id
		}
		for i, c := range changes {
			bad, conf, code, err := applyChange(ctx, q, m, c, idMap, mapID)
			if err != nil {
				return err
			}
			if bad != "" || conf != "" || code != 0 {
				prefix := fmt.Sprintf("Thay đổi %d: ", i+1)
				if bad != "" {
					out.bad = prefix + bad
				}
				if conf != "" {
					out.conf = prefix + conf
				}
				out.code = code
				return errRollback
			}
		}
		// The view: temp ids become real ones; new refs must be visible, refs already stored may stay hidden.
		before, err := storedView(ctx, q, m, d.ID)
		if err != nil {
			return err
		}
		kept := map[uuid.UUID]bool{}
		for _, n := range before.Nodes {
			kept[n.RefId] = true
		}
		for _, e := range before.Edges {
			kept[e.LinkId] = true
		}
		if msg, err := checkFrameRefs(ctx, q, m, b.View, before); err != nil || msg != "" {
			out.bad = msg
			return orRollback(err)
		}
		check := newRefChecker(ctx, q, m)
		view := b.View
		for i := range view.Nodes {
			n := &view.Nodes[i]
			n.RefId = mapID(n.RefId)
			if kept[n.RefId] {
				continue
			}
			if ok, err := check.visible(string(n.RefKind), n.RefId); err != nil {
				return err
			} else if !ok {
				out.bad = fmt.Sprintf("Node %s tham chiếu đối tượng không tồn tại", n.Id)
				return errRollback
			}
		}
		for i := range view.Edges {
			e := &view.Edges[i]
			e.LinkId = mapID(e.LinkId)
			if kept[e.LinkId] {
				continue
			}
			if ok, err := check.visible("link", e.LinkId); err != nil {
				return err
			} else if !ok {
				out.bad = fmt.Sprintf("Cạnh %s tham chiếu link không tồn tại", e.Id)
				return errRollback
			}
		}
		raw, err := json.Marshal(view)
		if err != nil {
			return fmt.Errorf("encode view: %w", err)
		}
		if _, err := q.SaveDiagramView(ctx, store.SaveDiagramViewParams{ID: d.ID, OrganizationID: m.OrgID, Version: b.Version, View: raw}); errors.Is(err, pgx.ErrNoRows) {
			out.conf = msgDiagramStale
			return errRollback
		} else if err != nil {
			return fmt.Errorf("save view: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "diagram.save", ObjectType: "diagram",
			ObjectID: uuidStr(d.ID), After: map[string]int{"nodes": len(view.Nodes), "edges": len(view.Edges),
				"annotations": len(view.Annotations), "changes": len(changes)}, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		after, lv, _, err := loadDiagram(ctx, q, m, req.DiagramId)
		if err != nil {
			return err
		}
		result.IdMap = map[string]uuid.UUID{}
		for t, r := range idMap {
			result.IdMap[t.String()] = r
		}
		result.Detail, err = s.diagramDetail(ctx, q, m, after, lv)
		return err
	})
	switch {
	case err != nil:
		return nil, err
	case out.code == 404 && out.bad == "" && out.conf == "":
		return apigen.SaveDiagram404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
	case out.bad != "":
		return apigen.SaveDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.SaveDiagram403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.SaveDiagram409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.SaveDiagram200JSONResponse(result), nil
}

// applyChange runs one inventory change of a save; returns a 400 message, a 409 message or a 403/404 code.
func applyChange(ctx context.Context, q store.Querier, m tenant.Membership, c apigen.DiagramChange, idMap map[uuid.UUID]uuid.UUID, mapID func(uuid.UUID) uuid.UUID) (string, string, int, error) {
	refusal := func(err error) (bool, error) {
		if errors.Is(err, errRollback) {
			return true, nil
		}
		return false, err
	}
	needID := func() (uuid.UUID, string) {
		if c.Id == nil {
			return uuid.Nil, "thiếu id"
		}
		return mapID(*c.Id), ""
	}
	switch c.Op {
	case apigen.CreateDevice:
		if c.TempId == nil || c.Device == nil {
			return "tạo thiết bị cần tempId và device", "", 0, nil
		}
		f, bad := validateDevice(bodyFromInput(*c.Device))
		if bad != "" {
			return bad, "", 0, nil
		}
		var out deviceOutcome
		if stop, err := refusal(writeDevice(ctx, q, m, f, nil, 0, &out)); err != nil || stop {
			return deviceRefusal(out, err)
		}
		idMap[*c.TempId] = uuid.UUID(out.device.ID.Bytes)
		if c.PortTempIds != nil && len(*c.PortTempIds) > 0 {
			// Ports drawn on before the save (generated from the template just now) get their real ids.
			ports, err := q.ListInterfaces(ctx, store.ListInterfacesParams{OrganizationID: m.OrgID, DeviceID: out.device.ID})
			if err != nil {
				return "", "", 0, fmt.Errorf("new device ports: %w", err)
			}
			byName := map[string]uuid.UUID{}
			for _, p := range ports {
				byName[strings.ToLower(p.Name)] = uuid.UUID(p.ID.Bytes)
			}
			for _, pt := range *c.PortTempIds {
				real, ok := byName[strings.ToLower(pt.Name)]
				if !ok {
					return fmt.Sprintf("cổng %s không có trong thiết bị mới %s", pt.Name, out.device.Hostname), "", 0, nil
				}
				idMap[pt.TempId] = real
			}
		}
	case apigen.UpdateDevice:
		id, bad := needID()
		if bad != "" || c.DeviceUpdate == nil {
			return "sửa thiết bị cần id và deviceUpdate", "", 0, nil
		}
		f, bad := validateDevice(bodyFromInput(inputFromUpdate(*c.DeviceUpdate)))
		if bad != "" {
			return bad, "", 0, nil
		}
		var out deviceOutcome
		if stop, err := refusal(writeDevice(ctx, q, m, f, &id, c.DeviceUpdate.Version, &out)); err != nil || stop {
			return deviceRefusal(out, err)
		}
	case apigen.DeleteDevice:
		id, bad := needID()
		if bad != "" {
			return bad, "", 0, nil
		}
		code, err := deleteDeviceTx(ctx, q, m, id)
		if code == 404 {
			return "thiết bị không tồn tại", "", 0, err
		}
		return "", "", code, err
	case apigen.CreateEndpointGroup, apigen.UpdateEndpointGroup:
		// Endpoints drawn on the diagram (ADR-036): a group stands for many alike devices, not in the device list.
		var (
			in      apigen.EndpointGroupInput
			id      *uuid.UUID
			version int32
		)
		if c.Op == apigen.CreateEndpointGroup {
			if c.TempId == nil || c.EndpointGroup == nil {
				return "tạo nhóm đầu cuối cần tempId và endpointGroup", "", 0, nil
			}
			in = *c.EndpointGroup
		} else {
			gid, bad := needID()
			if bad != "" || c.EndpointGroupUpdate == nil {
				return "sửa nhóm đầu cuối cần id và endpointGroupUpdate", "", 0, nil
			}
			u := c.EndpointGroupUpdate
			in = apigen.EndpointGroupInput{Kind: u.Kind, Name: u.Name, SiteId: u.SiteId, IpRangeId: u.IpRangeId,
				ExpectedCount: u.ExpectedCount, Notes: u.Notes}
			id, version = &gid, u.Version
		}
		f, bad := validateGroup(in.Kind, in.Name, in.SiteId, in.IpRangeId, in.ExpectedCount, in.Notes)
		if bad != "" {
			return bad, "", 0, nil
		}
		var out writeOutcome
		g, err := writeGroup(ctx, q, m, f, id, version, &out)
		if stop, err := refusal(err); err != nil || stop {
			if out.gone {
				return "nhóm đầu cuối không tồn tại", "", 0, err
			}
			return out.bad, out.conf, out.code, err
		}
		if c.Op == apigen.CreateEndpointGroup {
			idMap[*c.TempId] = uuid.UUID(g.ID.Bytes)
		}
	case apigen.CreateLink, apigen.UpdateLink:
		var in apigen.LinkInput
		var id *uuid.UUID
		var version int32
		if c.Op == apigen.CreateLink {
			if c.TempId == nil || c.Link == nil {
				return "tạo link cần tempId và link", "", 0, nil
			}
			in = *c.Link
		} else {
			lid, bad := needID()
			if bad != "" || c.LinkUpdate == nil {
				return "sửa link cần id và linkUpdate", "", 0, nil
			}
			u := c.LinkUpdate
			in = apigen.LinkInput{A: u.A, B: u.B, Kind: u.Kind, Medium: u.Medium, Speed: u.Speed, LengthM: u.LengthM, CableId: u.CableId,
				Status: u.Status, FiberMode: u.FiberMode, Connector: u.Connector, Service: u.Service,
				Provider: u.Provider, CircuitId: u.CircuitId, Bandwidth: u.Bandwidth, Notes: u.Notes}
			id, version = &lid, u.Version
		}
		in.A.Id, in.B.Id = mapID(in.A.Id), mapID(in.B.Id)
		// A port of a device created in this save is named by its temp id.
		for _, iface := range []*uuid.UUID{in.A.InterfaceId, in.B.InterfaceId} {
			if iface != nil {
				*iface = mapID(*iface)
			}
		}
		var out writeOutcome
		l, err := writeLink(ctx, q, m, in, id, version, &out)
		if stop, err := refusal(err); err != nil || stop {
			if out.gone {
				return "link không tồn tại", "", 0, err
			}
			return out.bad, out.conf, out.code, err
		}
		if c.Op == apigen.CreateLink {
			idMap[*c.TempId] = l.Id
		}
	case apigen.DeleteLink:
		id, bad := needID()
		if bad != "" {
			return bad, "", 0, nil
		}
		row, l, ok, err := loadLink(ctx, q, m, pgUUID(id))
		if err != nil {
			return "", "", 0, err
		}
		if !ok {
			return "link không tồn tại", "", 0, nil
		}
		if l.Access == apigen.AccessLevelView {
			return "", "", 403, nil
		}
		if _, err := q.DeleteLink(ctx, store.DeleteLinkParams{ID: row.ID, OrganizationID: m.OrgID}); err != nil {
			return "", "", 0, fmt.Errorf("delete link: %w", err)
		}
		return "", "", 0, audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "link.delete", ObjectType: "link",
			ObjectID: uuidStr(row.ID), Before: snapLinkRow(row), Meta: infoFrom(ctx).meta})
	default:
		return "loại thay đổi không hợp lệ", "", 0, nil
	}
	return "", "", 0, nil
}

func deviceRefusal(out deviceOutcome, err error) (string, string, int, error) {
	switch {
	case err != nil:
		return "", "", 0, err
	case out.notFound:
		return "thiết bị không tồn tại", "", 0, nil
	case out.forbidden:
		return "", "", 403, nil
	}
	return out.bad, out.conflict, 0, nil
}

// checkFrameRefs: a frame's site / location must belong to the organization (ADR-032). A binding already stored may
// stay even if the site was deleted since (the frame then shows it as deleted).
func checkFrameRefs(ctx context.Context, q store.Querier, m tenant.Membership, v, before apigen.DiagramView) (string, error) {
	stored := map[string]bool{}
	key := func(a apigen.DiagramAnnotation) string {
		k := ""
		if a.SiteId != nil {
			k += a.SiteId.String()
		}
		if a.LocationId != nil {
			k += "/" + a.LocationId.String()
		}
		return k
	}
	for _, a := range before.Annotations {
		stored[a.Id+"|"+key(a)] = true
	}
	for _, a := range v.Annotations {
		if a.SiteId == nil || stored[a.Id+"|"+key(a)] {
			continue
		}
		if _, err := q.GetSite(ctx, store.GetSiteParams{ID: pgUUID(*a.SiteId), OrganizationID: m.OrgID}); errors.Is(err, pgx.ErrNoRows) {
			return "Khung gắn một site không tồn tại trong tổ chức", nil
		} else if err != nil {
			return "", fmt.Errorf("frame site: %w", err)
		}
		if a.LocationId != nil {
			_, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(*a.LocationId), OrganizationID: m.OrgID, SiteID: pgUUID(*a.SiteId)})
			if errors.Is(err, pgx.ErrNoRows) {
				return "Khung gắn một location không thuộc site của khung", nil
			} else if err != nil {
				return "", fmt.Errorf("frame location: %w", err)
			}
		}
	}
	return "", nil
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// validColor: no colour, a palette name, or a colour picked freely as #rrggbb (drawn inline, so nothing else).
func validColor(c string) bool {
	switch c {
	case "", "blue", "green", "amber", "red", "violet", "slate":
		return true
	}
	return hexColor.MatchString(c)
}
