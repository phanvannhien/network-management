package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Links (P1-12, SRS §6.2, ADR-012/013). A link is seen when both ends are (an end is visible like its device or
// endpoint group, ADR-031) and changed with edit rights on at least one end. Physical kinds occupy physical ports —
// one link per port; logical links (VPN, GRE, LAG) use virtual interfaces or no port.

const msgLinkNotFound = "Không tìm thấy link"

type endKey struct {
	kind string
	id   pgtype.UUID
}

// linkLevels: the caller's level on each end of the rows (None when the end is gone or invisible).
func linkLevels(ctx context.Context, q store.Querier, m tenant.Membership, rows []store.ListLinksRow) (map[endKey]int, error) {
	var refs []siteRef
	seen := map[pgtype.UUID]bool{}
	add := func(site, unit, partner pgtype.UUID) {
		if site.Valid && !seen[site] {
			seen[site] = true
			refs = append(refs, siteRef{site, unit, partner})
		}
	}
	for _, r := range rows {
		add(r.ASiteID, r.ASiteUnitID, r.ASitePartnerID)
		add(r.BSiteID, r.BSiteUnitID, r.BSitePartnerID)
	}
	sites, err := siteLevels(ctx, q, m, refs)
	if err != nil {
		return nil, err
	}
	out := map[endKey]int{}
	for _, r := range rows {
		if r.ASiteID.Valid {
			out[endKey{r.AKind, r.AID}] = max(m.UnitLevel(r.AUnitID, r.APartnerID), sites[r.ASiteID])
		}
		if r.BSiteID.Valid {
			out[endKey{r.BKind, r.BID}] = max(m.UnitLevel(r.BUnitID, r.BPartnerID), sites[r.BSiteID])
		}
	}
	return out, nil
}

func numericPtr(n pgtype.Numeric) *float32 {
	if !n.Valid {
		return nil
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return nil
	}
	v := float32(f.Float64)
	return &v
}

func toLink(r store.ListLinksRow, level int) apigen.Link {
	end := func(kind string, id, site pgtype.UUID, name, typ, siteCode string, iface pgtype.UUID, ifName, ifKind, ifMedia string) apigen.LinkEnd {
		return apigen.LinkEnd{Kind: apigen.LinkEndKind(kind), Id: uuid.UUID(id.Bytes), Name: name, Type: typ, SiteId: uuid.UUID(site.Bytes),
			SiteCode: siteCode, InterfaceId: optUUID(iface), InterfaceName: ifName, InterfaceKind: ifKind, InterfaceMedia: ifMedia}
	}
	return apigen.Link{
		Id:   uuid.UUID(r.ID.Bytes),
		A:    end(r.AKind, r.AID, r.ASiteID, r.AName, r.AType, r.ASiteCode, r.AInterfaceID, r.AInterfaceName, r.AInterfaceKind, r.AInterfaceMedia),
		B:    end(r.BKind, r.BID, r.BSiteID, r.BName, r.BType, r.BSiteCode, r.BInterfaceID, r.BInterfaceName, r.BInterfaceKind, r.BInterfaceMedia),
		Kind: apigen.LinkKind(r.Kind), Medium: r.Medium, Speed: r.Speed, LengthM: numericPtr(r.LengthM), CableId: r.CableID,
		Status: apigen.LinkStatus(r.Status), Provider: r.Provider, CircuitId: r.CircuitID, Bandwidth: r.Bandwidth, Notes: r.Notes,
		Access: levelName(level), Version: r.Version,
	}
}

// visibleLinks keeps rows whose both ends the caller sees, with the link level = the better end's level.
func visibleLinks(ctx context.Context, q store.Querier, m tenant.Membership, rows []store.ListLinksRow) ([]apigen.Link, error) {
	levels, err := linkLevels(ctx, q, m, rows)
	if err != nil {
		return nil, err
	}
	out := make([]apigen.Link, 0, len(rows))
	for _, r := range rows {
		a, b := levels[endKey{r.AKind, r.AID}], levels[endKey{r.BKind, r.BID}]
		if a == tenant.LevelNone || b == tenant.LevelNone {
			continue
		}
		out = append(out, toLink(r, min(max(a, b), tenant.LevelEdit)))
	}
	return out, nil
}

func loadLink(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (store.ListLinksRow, apigen.Link, bool, error) {
	rows, err := q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, LinkID: id})
	if err != nil {
		return store.ListLinksRow{}, apigen.Link{}, false, fmt.Errorf("load link: %w", err)
	}
	links, err := visibleLinks(ctx, q, m, rows)
	if err != nil || len(links) == 0 {
		return store.ListLinksRow{}, apigen.Link{}, false, err
	}
	return rows[0], links[0], true, nil
}

func (s *Server) ListLinks(ctx context.Context, req apigen.ListLinksRequestObject) (apigen.ListLinksResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	params := store.ListLinksParams{OrganizationID: m.OrgID}
	if req.Params.EndId != nil {
		params.EndID = pgUUID(*req.Params.EndId)
	}
	if req.Params.SiteId != nil {
		params.SiteID = pgUUID(*req.Params.SiteId)
	}
	rows, err := s.q.ListLinks(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list links: %w", err)
	}
	links, err := visibleLinks(ctx, s.q, m, rows)
	if err != nil {
		return nil, err
	}
	return apigen.ListLinks200JSONResponse{Links: links}, nil
}

// --- writes ---

type linkEnd struct {
	kind      string
	id, iface pgtype.UUID
	label     string // HOST or HOST:port, for messages and audit
	ifaceKind string
	level     int
}

// resolveEnd checks an end exists for the caller and its interface belongs to it.
func resolveEnd(ctx context.Context, q store.Querier, m tenant.Membership, in apigen.LinkEndInput, side string) (linkEnd, string, error) {
	e := linkEnd{kind: string(in.Kind), id: pgUUID(in.Id)}
	switch in.Kind {
	case apigen.LinkEndKindDevice:
		d, ok, err := loadDevice(ctx, q, m, in.Id)
		if err != nil {
			return e, "", err
		}
		if !ok {
			return e, fmt.Sprintf("Thiết bị ở đầu %s không tồn tại", side), nil
		}
		if e.level, err = deviceLevel(ctx, q, m, d); err != nil {
			return e, "", err
		}
		e.label = d.Hostname
	case apigen.LinkEndKindEndpointGroup:
		g, ok, err := loadGroup(ctx, q, m, in.Id)
		if err != nil {
			return e, "", err
		}
		if !ok {
			return e, fmt.Sprintf("Nhóm thiết bị ở đầu %s không tồn tại", side), nil
		}
		if in.InterfaceId != nil {
			return e, "Nhóm thiết bị đầu cuối không có cổng — để trống cổng ở đầu nhóm", nil
		}
		if e.level, err = groupLevel(ctx, q, m, g); err != nil {
			return e, "", err
		}
		e.label = g.Name
	default:
		return e, "Loại đầu link không hợp lệ", nil
	}
	if in.InterfaceId != nil {
		i, err := q.GetLinkEndInterface(ctx, store.GetLinkEndInterfaceParams{ID: pgUUID(*in.InterfaceId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && i.DeviceID != e.id) {
			return e, fmt.Sprintf("Cổng ở đầu %s không phải interface của %s", side, e.label), nil
		}
		if err != nil {
			return e, "", fmt.Errorf("load interface: %w", err)
		}
		e.iface, e.ifaceKind, e.label = i.ID, i.Kind, e.label+" "+i.Name
	}
	return e, "", nil
}

type linkFields struct {
	kind, medium, speed, cable, status, provider, circuit, bandwidth, notes string
	length                                                                  pgtype.Numeric
}

func validateLink(b apigen.LinkInput) (linkFields, string) {
	f := linkFields{kind: string(b.Kind), medium: strings.TrimSpace(str(b.Medium)), speed: strings.TrimSpace(str(b.Speed)),
		cable: strings.TrimSpace(str(b.CableId)), status: "up", provider: strings.TrimSpace(str(b.Provider)),
		circuit: strings.TrimSpace(str(b.CircuitId)), bandwidth: strings.TrimSpace(str(b.Bandwidth)), notes: str(b.Notes)}
	if b.Status != nil {
		f.status = string(*b.Status)
	}
	if b.LengthM != nil {
		if *b.LengthM <= 0 || *b.LengthM > 9999999 {
			return f, "Chiều dài cáp phải lớn hơn 0 (mét)"
		}
		if err := f.length.Scan(strconv.FormatFloat(float64(*b.LengthM), 'f', 1, 32)); err != nil {
			return f, "Chiều dài cáp không hợp lệ"
		}
	}
	switch {
	case !b.Kind.Valid():
		return f, "Loại link không hợp lệ"
	case !apigen.LinkStatus(f.status).Valid():
		return f, "Trạng thái link không hợp lệ"
	case tooLong(f.medium, 40) || tooLong(f.speed, 20) || tooLong(f.cable, 64) || tooLong(f.provider, 100) ||
		tooLong(f.circuit, 100) || tooLong(f.bandwidth, 40) || tooLong(f.notes, 2000):
		return f, "Một trường vượt quá độ dài cho phép"
	}
	return f, ""
}

type linkSnapshot struct {
	A      string `json:"a"`
	B      string `json:"b"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Medium string `json:"medium,omitempty"`
	Speed  string `json:"speed,omitempty"`
	Cable  string `json:"cableId,omitempty"`
}

func snapLinkRow(r store.ListLinksRow) linkSnapshot {
	label := func(name, iface string) string { return strings.TrimSpace(name + " " + iface) }
	return linkSnapshot{label(r.AName, r.AInterfaceName), label(r.BName, r.BInterfaceName), r.Kind, r.Status, r.Medium, r.Speed, r.CableID}
}

// checkLinkEnds applies the connection rules; returns a 400 message, 403 code or 409 message.
func checkLinkEnds(ctx context.Context, q store.Querier, m tenant.Membership, kind string, a, b linkEnd, self pgtype.UUID) (string, int, string, error) {
	if a.kind == "endpoint_group" && b.kind == "endpoint_group" {
		return "Một đầu link phải là thiết bị (nhóm đầu cuối nối vào switch, AP…)", 0, "", nil
	}
	if a.kind == b.kind && a.id == b.id && (!a.iface.Valid || !b.iface.Valid || a.iface == b.iface) {
		return "Link phải nối hai cổng khác nhau (hoặc hai thiết bị khác nhau)", 0, "", nil
	}
	for _, e := range []linkEnd{a, b} {
		if !e.iface.Valid {
			continue
		}
		if kind == "logical" && e.ifaceKind == "physical" {
			return fmt.Sprintf("Link logical (VPN, GRE, LAG) dùng interface ảo như tunnel hoặc LAG — %s là cổng vật lý", e.label), 0, "", nil
		}
		if kind != "logical" && e.ifaceKind != "physical" {
			return fmt.Sprintf("%s là interface ảo — link vật lý chỉ nối vào cổng vật lý (VPN/GRE/LAG chọn loại Logical)", e.label), 0, "", nil
		}
	}
	if max(a.level, b.level) < tenant.LevelEdit {
		return "", 403, "", nil
	}
	if kind != "logical" {
		for _, e := range []linkEnd{a, b} {
			if !e.iface.Valid {
				continue
			}
			if err := q.LockInterfaceLinks(ctx, m.OrgID.String()+"/iface/"+uuidStr(e.iface)); err != nil {
				return "", 0, "", fmt.Errorf("lock interface: %w", err)
			}
			n, err := q.CountPhysicalLinksOnInterface(ctx, store.CountPhysicalLinksOnInterfaceParams{OrganizationID: m.OrgID, SelfID: self, InterfaceID: e.iface})
			if err != nil {
				return "", 0, "", fmt.Errorf("count port links: %w", err)
			}
			if n > 0 {
				return "", 0, fmt.Sprintf("Cổng %s đã có link — một cổng vật lý chỉ cắm được một dây", e.label), nil
			}
		}
	}
	return "", 0, "", nil
}

func (s *Server) saveLink(ctx context.Context, m tenant.Membership, b apigen.LinkInput, id *uuid.UUID, version int32) (apigen.Link, writeOutcome, error) {
	var (
		out   writeOutcome
		saved apigen.Link
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		var err error
		saved, err = writeLink(ctx, q, m, b, id, version, &out)
		return err
	})
	return saved, out, err
}

// writeLink creates (id nil) or updates a link inside the caller's transaction; a refusal is reported in out with
// errRollback.
func writeLink(ctx context.Context, q store.Querier, m tenant.Membership, b apigen.LinkInput, id *uuid.UUID, version int32, out *writeOutcome) (apigen.Link, error) {
	var saved apigen.Link
	f, bad := validateLink(b)
	if bad != "" {
		out.bad = bad
		return saved, errRollback
	}
	err := func() error {
		var before store.ListLinksRow
		self := pgtype.UUID{}
		if id != nil {
			var cur apigen.Link
			var ok bool
			var err error
			if before, cur, ok, err = loadLink(ctx, q, m, pgUUID(*id)); err != nil {
				return err
			}
			if !ok {
				out.gone = true
				return errRollback
			}
			if cur.Access != apigen.AccessLevelEdit && cur.Access != apigen.AccessLevelAdmin {
				out.code = 403
				return errRollback
			}
			self = before.ID
		}
		a, bad, err := resolveEnd(ctx, q, m, b.A, "A")
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		bb, bad, err := resolveEnd(ctx, q, m, b.B, "B")
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		bad, code, conf, err := checkLinkEnds(ctx, q, m, f.kind, a, bb, self)
		if err != nil || bad != "" || code != 0 || conf != "" {
			out.bad, out.code, out.conf = bad, code, conf
			return orRollback(err)
		}
		var lid pgtype.UUID
		if id == nil {
			lid, err = q.CreateLink(ctx, store.CreateLinkParams{OrganizationID: m.OrgID, AKind: a.kind, AID: a.id, AInterfaceID: a.iface,
				BKind: bb.kind, BID: bb.id, BInterfaceID: bb.iface, Kind: f.kind, Medium: f.medium, Speed: f.speed, LengthM: f.length,
				CableID: f.cable, Status: f.status, Provider: f.provider, CircuitID: f.circuit, Bandwidth: f.bandwidth, Notes: f.notes})
			if err != nil {
				return fmt.Errorf("create link: %w", err)
			}
		} else {
			lid = before.ID
			n, err := q.UpdateLink(ctx, store.UpdateLinkParams{ID: before.ID, OrganizationID: m.OrgID, Version: version, AKind: a.kind,
				AID: a.id, AInterfaceID: a.iface, BKind: bb.kind, BID: bb.id, BInterfaceID: bb.iface, Kind: f.kind, Medium: f.medium,
				Speed: f.speed, LengthM: f.length, CableID: f.cable, Status: f.status, Provider: f.provider, CircuitID: f.circuit,
				Bandwidth: f.bandwidth, Notes: f.notes})
			if err != nil {
				return fmt.Errorf("update link: %w", err)
			}
			if n == 0 {
				out.conf = msgStale
				return errRollback
			}
		}
		after, link, ok, err := loadLink(ctx, q, m, lid)
		if err != nil || !ok {
			out.code = 403
			return orRollback(err)
		}
		saved = link
		entry := audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "link.create", ObjectType: "link", ObjectID: uuidStr(lid),
			After: snapLinkRow(after), Meta: infoFrom(ctx).meta}
		if id != nil {
			entry.Action, entry.Before = "link.update", snapLinkRow(before)
		}
		return audit.Write(ctx, q, entry)
	}()
	return saved, err
}

func (s *Server) CreateLink(ctx context.Context, req apigen.CreateLinkRequestObject) (apigen.CreateLinkResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateLink400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	l, out, err := s.saveLink(ctx, m, *req.Body, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateLink400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.CreateLink403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.CreateLink409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.CreateLink201JSONResponse(l), nil
}

func (s *Server) UpdateLink(ctx context.Context, req apigen.UpdateLinkRequestObject) (apigen.UpdateLinkResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateLink400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	if _, _, ok, err := loadLink(ctx, s.q, m, pgUUID(req.LinkId)); err != nil {
		return nil, err
	} else if !ok {
		return apigen.UpdateLink404JSONResponse{NotFoundJSONResponse: notFoundBody(msgLinkNotFound)}, nil
	}
	in := apigen.LinkInput{A: b.A, B: b.B, Kind: b.Kind, Medium: b.Medium, Speed: b.Speed, LengthM: b.LengthM, CableId: b.CableId,
		Status: b.Status, Provider: b.Provider, CircuitId: b.CircuitId, Bandwidth: b.Bandwidth, Notes: b.Notes}
	id := req.LinkId
	l, out, err := s.saveLink(ctx, m, in, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.gone:
		return apigen.UpdateLink404JSONResponse{NotFoundJSONResponse: notFoundBody(msgLinkNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateLink400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.code == 403:
		return apigen.UpdateLink403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conf != "":
		return apigen.UpdateLink409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	}
	return apigen.UpdateLink200JSONResponse(l), nil
}

func (s *Server) DeleteLink(ctx context.Context, req apigen.DeleteLinkRequestObject) (apigen.DeleteLinkResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		row, l, ok, err := loadLink(ctx, q, m, pgUUID(req.LinkId))
		if err != nil {
			return err
		}
		if !ok {
			out.gone = true
			return errRollback
		}
		if l.Access != apigen.AccessLevelEdit && l.Access != apigen.AccessLevelAdmin {
			out.code = 403
			return errRollback
		}
		if _, err := q.DeleteLink(ctx, store.DeleteLinkParams{ID: row.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete link: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "link.delete", ObjectType: "link",
			ObjectID: uuidStr(row.ID), Before: snapLinkRow(row), Meta: infoFrom(ctx).meta})
	})
	switch {
	case out.gone:
		return apigen.DeleteLink404JSONResponse{NotFoundJSONResponse: notFoundBody(msgLinkNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteLink403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteLink204Response{}, nil
}

// deleteLinksOf removes the links of a deleted device / endpoint group, with one audit entry each.
func deleteLinksOf(ctx context.Context, q store.Querier, m tenant.Membership, kind string, id pgtype.UUID) error {
	rows, err := q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, EndID: id})
	if err != nil {
		return fmt.Errorf("list links: %w", err)
	}
	if _, err := q.DeleteLinksOfEnd(ctx, store.DeleteLinksOfEndParams{OrganizationID: m.OrgID, EndKind: kind, EndID: id}); err != nil {
		return fmt.Errorf("delete links: %w", err)
	}
	for _, r := range rows {
		if (r.AKind == kind && r.AID == id) || (r.BKind == kind && r.BID == id) {
			if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "link.delete", ObjectType: "link",
				ObjectID: uuidStr(r.ID), Before: snapLinkRow(r), Meta: infoFrom(ctx).meta}); err != nil {
				return err
			}
		}
	}
	return nil
}
