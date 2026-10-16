package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Diagrams (P1-13, ADR-015/028): a view over the inventory with a scope (organization, business unit, site). The
// editor saves the view and its inventory changes in one transaction under an optimistic lock. Nodes referring to
// objects the caller may not see are kept as hidden refs: returned by id only and accepted back unchanged.

const (
	msgDiagramNotFound = "Không tìm thấy sơ đồ"
	msgDiagramStale    = "Sơ đồ đã được người khác lưu sau khi bạn mở — tải lại để xem bản mới (nháp của bạn vẫn được giữ)"
	maxNodes           = 5000
	maxEdges           = 10000
	maxAnnotations     = 2000
	maxChanges         = 2000
	maxCoord           = 1e7
)

func diagramLevel(ctx context.Context, q store.Querier, m tenant.Membership, d store.ListDiagramsRow) (int, error) {
	switch d.Scope {
	case "business_unit":
		return m.UnitLevel(d.BusinessUnitID, d.PartnerID), nil
	case "site":
		levels, err := siteLevels(ctx, q, m, []siteRef{{d.SiteID, d.SiteUnitID, d.SitePartnerID}})
		if err != nil {
			return 0, err
		}
		return levels[d.SiteID], nil
	}
	return m.UnitLevel(pgtype.UUID{}, pgtype.UUID{}), nil // organization role
}

func toDiagram(d store.ListDiagramsRow, level int) apigen.Diagram {
	return apigen.Diagram{
		Id: uuid.UUID(d.ID.Bytes), Name: d.Name, Scope: apigen.DiagramScope(d.Scope), BusinessUnitId: optUUID(d.BusinessUnitID),
		SiteId: optUUID(d.SiteID), PartnerCode: d.PartnerCode, UnitCode: d.UnitCode, SiteCode: d.SiteCode, SiteName: d.SiteName,
		Layer: apigen.DiagramLayer(d.Layer), Description: d.Description, NodeCount: d.NodeCount, UpdatedAt: d.UpdatedAt.Time,
		Access: levelName(level), Version: d.Version,
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
	var deviceIDs, endIDs []pgtype.UUID
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
	return out, nil
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
	Scope string `json:"scope"`
	Of    string `json:"of,omitempty"`
	Layer string `json:"layer"`
}

func snapDiagram(d store.ListDiagramsRow) diagramSnapshot {
	of := d.SiteCode
	if d.Scope == "business_unit" {
		of = d.PartnerCode + "/" + d.UnitCode
	}
	return diagramSnapshot{d.Name, d.Scope, of, d.Layer}
}

func (s *Server) CreateDiagram(ctx context.Context, req apigen.CreateDiagramRequestObject) (apigen.CreateDiagramResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	bad := func(msg string) (apigen.CreateDiagramResponseObject, error) {
		return apigen.CreateDiagram400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
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
	case !b.Scope.Valid() || !apigen.DiagramLayer(layer).Valid():
		return bad("Phạm vi hoặc lớp sơ đồ không hợp lệ")
	case tooLong(desc, 1000):
		return bad("Mô tả tối đa 1000 ký tự")
	}
	var (
		unit, site pgtype.UUID
		level      int
		msg        string
		detail     apigen.DiagramDetail
		conflict   bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		switch b.Scope {
		case apigen.DiagramScopeOrganization:
			level = m.UnitLevel(pgtype.UUID{}, pgtype.UUID{})
		case apigen.DiagramScopeBusinessUnit:
			if b.BusinessUnitId == nil {
				msg = "Chọn đơn vị cho sơ đồ"
				return errRollback
			}
			u, err := q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(*b.BusinessUnitId), OrganizationID: m.OrgID})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.UnitLevel(u.ID, u.PartnerID) == tenant.LevelNone) {
				msg = msgUnitMissing
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("load unit: %w", err)
			}
			unit, level = u.ID, m.UnitLevel(u.ID, u.PartnerID)
		case apigen.DiagramScopeSite:
			if b.SiteId == nil {
				msg = "Chọn site cho sơ đồ"
				return errRollback
			}
			st, ok, err := loadSite(ctx, q, m, *b.SiteId)
			if err != nil {
				return err
			}
			if !ok {
				msg = "Site không tồn tại trong tổ chức"
				return errRollback
			}
			if level, err = siteLevel(ctx, q, m, st); err != nil {
				return err
			}
			site = st.ID
		}
		if level < tenant.LevelEdit {
			return errRollback
		}
		id, err := q.CreateDiagram(ctx, store.CreateDiagramParams{OrganizationID: m.OrgID, Scope: string(b.Scope), BusinessUnitID: unit,
			SiteID: site, Name: name, Layer: layer, Description: desc, CreatedBy: pgUUID(uuid.UUID(m.UserID.Bytes))})
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
	case msg != "":
		return bad(msg)
	case conflict:
		return apigen.CreateDiagram409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: fmt.Sprintf("Đã có sơ đồ tên %s trong phạm vi này", name)}}, nil
	case level < tenant.LevelEdit:
		return apigen.CreateDiagram403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
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
			conf = fmt.Sprintf("Đã có sơ đồ tên %s trong phạm vi này", name)
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
	}
	if v.Viewport != nil && (!finite(v.Viewport.X, v.Viewport.Y) || v.Viewport.Zoom < 0.05 || v.Viewport.Zoom > 10) {
		return "Viewport không hợp lệ"
	}
	if v.LabelTemplate != nil && len(*v.LabelTemplate) > 200 {
		return "Mẫu nhãn tối đa 200 ký tự"
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
				Status: u.Status, Provider: u.Provider, CircuitId: u.CircuitId, Bandwidth: u.Bandwidth, Notes: u.Notes}
			id, version = &lid, u.Version
		}
		in.A.Id, in.B.Id = mapID(in.A.Id), mapID(in.B.Id)
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
