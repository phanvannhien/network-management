package api

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Sites, locations and racks (P1-07, ADR-025). Every handler resolves the site through GetSite with the
// member's site filter, so a site outside the organization or outside the member's scope is a 404.

const (
	defaultTimezone = "Asia/Ho_Chi_Minh"
	defaultRackU    = 42

	msgSiteNotFound     = "Không tìm thấy site"
	msgLocationNotFound = "Không tìm thấy location"
	msgRackNotFound     = "Không tìm thấy rack"
	msgCannotEdit       = "Bạn chỉ có quyền xem"
	msgStale            = "Dữ liệu vừa được người khác sửa. Tải lại rồi thử lại."
)

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func isFKViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23503"
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func tooLong(s string, n int) bool { return utf8.RuneCountInString(s) > n }

// --- sites -------------------------------------------------------------------------------------------

var (
	siteKinds = []string{"office", "factory", "datacenter", "warehouse", "store", "other"}
	// ADR-030/031: <PARTNER>-<PLACE><NN>, PLACE = 2–4 letters, NN = 2 digits; organization-wide sites use SHARED.
	siteCodeRe = regexp.MustCompile(`^([A-Z][A-Z0-9]{1,7})-([A-Z]{2,4})([0-9]{2})$`)
	placeRe    = regexp.MustCompile(`^[A-Z]{2,4}$`)
)

const sharedPrefix = "SHARED"

type siteFields struct {
	code, name, address, timezone, contactName, contactPhone, contactEmail, notes, kind, isp string
	businessUnit                                                                             *uuid.UUID
}

func validateSite(code, name string, kind *apigen.SiteKind, bu *uuid.UUID, isp, address, timezone, contactName, contactPhone, contactEmail, notes *string) (siteFields, string) {
	f := siteFields{
		code: strings.ToUpper(strings.TrimSpace(code)), name: strings.TrimSpace(name), address: str(address), timezone: str(timezone),
		contactName: str(contactName), contactPhone: str(contactPhone), contactEmail: str(contactEmail), notes: str(notes),
		kind: "office", isp: str(isp), businessUnit: bu,
	}
	if kind != nil {
		f.kind = string(*kind)
	}
	switch {
	case !siteCodeRe.MatchString(f.code):
		return f, "Mã site phải theo dạng <MÃ ĐỐI TÁC>-<địa điểm 2–4 chữ><2 số>, vd AGRI-BD01 (site dùng chung: SHARED-HCM01)"
	case f.name == "" || tooLong(f.name, 200):
		return f, "Tên site bắt buộc, tối đa 200 ký tự"
	case !slices.Contains(siteKinds, f.kind):
		return f, "Loại site không hợp lệ"
	case tooLong(f.address, 500) || tooLong(f.contactName, 200) || tooLong(f.contactPhone, 50) || tooLong(f.notes, 2000) || tooLong(f.isp, 200):
		return f, "Một trường vượt quá độ dài cho phép"
	}
	if f.timezone == "" {
		f.timezone = defaultTimezone
	}
	if _, err := time.LoadLocation(f.timezone); err != nil || !strings.Contains(f.timezone, "/") && f.timezone != "UTC" {
		return f, "Múi giờ không hợp lệ (dạng IANA, vd Asia/Ho_Chi_Minh)"
	}
	if f.contactEmail != "" {
		if a, err := mail.ParseAddress(f.contactEmail); err != nil || a.Address != f.contactEmail || tooLong(f.contactEmail, 320) {
			return f, "Email liên hệ không hợp lệ"
		}
	}
	return f, ""
}

// resolveUnit loads the owning unit and checks the code prefix against it (ADR-030/031). Message = 400.
// A unit the caller cannot see is reported like a missing one, except the site's current unit (`current`),
// which share editors keep without seeing it. The zero row means a shared site.
func resolveUnit(ctx context.Context, q store.Querier, m tenant.Membership, f siteFields, current pgtype.UUID) (store.GetBusinessUnitRow, string, error) {
	prefix := siteCodeRe.FindStringSubmatch(f.code)[1]
	if f.businessUnit == nil {
		if prefix != sharedPrefix {
			return store.GetBusinessUnitRow{}, "Site dùng chung phải có mã bắt đầu bằng SHARED-", nil
		}
		return store.GetBusinessUnitRow{}, "", nil
	}
	unit, err := q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(*f.businessUnit), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && unit.ID != current && m.UnitLevel(unit.ID, unit.PartnerID) == tenant.LevelNone) {
		return store.GetBusinessUnitRow{}, msgUnitMissing, nil
	}
	if err != nil {
		return store.GetBusinessUnitRow{}, "", fmt.Errorf("load business unit: %w", err)
	}
	// ADR-031: the prefix is the code of the unit's partner (sites can move between a partner's units).
	if prefix != unit.PartnerCode {
		return store.GetBusinessUnitRow{}, fmt.Sprintf("Mã site của đối tác %s phải bắt đầu bằng %s-", unit.PartnerName, unit.PartnerCode), nil
	}
	return unit, "", nil
}

// siteSnapshot is what the audit log records for a site (no counts, no secrets).
type siteSnapshot struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	BusinessUnitID string `json:"businessUnitId,omitempty"`
	ISP            string `json:"isp"`
	Address        string `json:"address"`
	Timezone       string `json:"timezone"`
	ContactName    string `json:"contactName"`
	ContactPhone   string `json:"contactPhone"`
	ContactEmail   string `json:"contactEmail"`
	Notes          string `json:"notes"`
}

func snapSite(s store.GetSiteRow) siteSnapshot {
	bu := ""
	if s.BusinessUnitID.Valid {
		bu = uuidStr(s.BusinessUnitID)
	}
	return siteSnapshot{s.Code, s.Name, s.Kind, bu, s.Isp, s.Address, s.Timezone, s.ContactName, s.ContactPhone, s.ContactEmail, s.Notes}
}

func toSite(s store.GetSiteRow, locations, racks int64, level int) apigen.Site {
	var bu *uuid.UUID
	if s.BusinessUnitID.Valid {
		id := uuid.UUID(s.BusinessUnitID.Bytes)
		bu = &id
	}
	return apigen.Site{
		Id: uuid.UUID(s.ID.Bytes), Code: s.Code, Name: s.Name, Kind: apigen.SiteKind(s.Kind), BusinessUnitId: bu,
		BusinessUnitCode: s.BusinessUnitCode, BusinessUnitName: s.BusinessUnitName, Isp: s.Isp,
		PartnerId: optUUID(s.PartnerID), PartnerCode: s.PartnerCode, PartnerName: s.PartnerName,
		Address: s.Address, Timezone: s.Timezone,
		ContactName: s.ContactName, ContactPhone: s.ContactPhone, ContactEmail: s.ContactEmail, Notes: s.Notes,
		LocationCount: locations, RackCount: racks, Access: levelName(level), Version: s.Version, CreatedAt: s.CreatedAt.Time, UpdatedAt: s.UpdatedAt.Time,
	}
}

func (s *Server) siteCounts(ctx context.Context, m tenant.Membership, site store.GetSiteRow) (int64, int64, error) {
	// The site was already loaded with the caller's visibility; this only reads its counts.
	rows, err := s.q.ListSites(ctx, store.ListSitesParams{OrganizationID: m.OrgID, IDFilter: site.ID})
	if err != nil || len(rows) == 0 {
		return 0, 0, err
	}
	return rows[0].LocationCount, rows[0].RackCount, nil
}

// loadSite returns the site if it is live, in the organization and visible to the caller (ADR-031).
func loadSite(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetSiteRow, bool, error) {
	v := visibilityOf(m)
	site, err := q.GetSite(ctx, store.GetSiteParams{
		ID: pgUUID(id), OrganizationID: m.OrgID, Restricted: v.restricted,
		GrantUnits: v.grantUnits, GrantPartners: v.grantPartners, SharePartners: v.sharePts,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return store.GetSiteRow{}, false, nil
	}
	if err != nil {
		return store.GetSiteRow{}, false, fmt.Errorf("load site: %w", err)
	}
	return site, true, nil
}

func (s *Server) ListSites(ctx context.Context, req apigen.ListSitesRequestObject) (apigen.ListSitesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	v := visibilityOf(m)
	params := store.ListSitesParams{
		OrganizationID: m.OrgID, Restricted: v.restricted,
		GrantUnits: v.grantUnits, GrantPartners: v.grantPartners, SharePartners: v.sharePts,
	}
	if req.Params.BusinessUnitId != nil {
		params.BuFilter = pgUUID(*req.Params.BusinessUnitId)
	}
	if req.Params.PartnerId != nil {
		params.PartnerFilter = pgUUID(*req.Params.PartnerId)
	}
	if req.Params.Shared != nil && *req.Params.Shared {
		params.OnlyShared = true
	}
	rows, err := s.q.ListSites(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list sites: %w", err)
	}
	refs := make([]siteRef, len(rows))
	for i, r := range rows {
		refs[i] = siteRef{r.ID, r.BusinessUnitID, r.PartnerID}
	}
	levels, err := siteLevels(ctx, s.q, m, refs)
	if err != nil {
		return nil, err
	}
	out := apigen.SiteList{Sites: make([]apigen.Site, 0, len(rows))}
	for _, r := range rows {
		out.Sites = append(out.Sites, toSite(store.GetSiteRow{
			ID: r.ID, OrganizationID: r.OrganizationID, Code: r.Code, Name: r.Name, Address: r.Address, Timezone: r.Timezone,
			ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, Notes: r.Notes,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, Version: r.Version, Kind: r.Kind, BusinessUnitID: r.BusinessUnitID,
			Isp: r.Isp, BusinessUnitCode: r.BusinessUnitCode, BusinessUnitName: r.BusinessUnitName,
			PartnerID: r.PartnerID, PartnerCode: r.PartnerCode, PartnerName: r.PartnerName,
		}, r.LocationCount, r.RackCount, levels[r.ID]))
	}
	return apigen.ListSites200JSONResponse(out), nil
}

func (s *Server) GetSite(ctx context.Context, req apigen.GetSiteRequestObject) (apigen.GetSiteResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	site, ok, err := loadSite(ctx, s.q, m, req.SiteId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetSite404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	}
	locs, racks, err := s.siteCounts(ctx, m, site)
	if err != nil {
		return nil, fmt.Errorf("site counts: %w", err)
	}
	level, err := siteLevel(ctx, s.q, m, site)
	if err != nil {
		return nil, err
	}
	return apigen.GetSite200JSONResponse(toSite(site, locs, racks, level)), nil
}

// SuggestSiteCode returns the next free <UNIT|SHARED>-<PLACE><NN> code (ADR-030).
func (s *Server) SuggestSiteCode(ctx context.Context, req apigen.SuggestSiteCodeRequestObject) (apigen.SuggestSiteCodeResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	place := strings.ToUpper(strings.TrimSpace(req.Params.Place))
	if !placeRe.MatchString(place) {
		return apigen.SuggestSiteCode400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Mã địa điểm gồm 2–4 chữ cái, vd HY"}}, nil
	}
	prefix := sharedPrefix
	if req.Params.PartnerId != nil {
		partner, err := s.q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(*req.Params.PartnerId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !m.SeesPartner(partner.ID)) {
			return apigen.SuggestSiteCode404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy đối tác"}}, nil
		}
		if err != nil {
			return nil, fmt.Errorf("load partner: %w", err)
		}
		prefix = partner.Code
	}
	base := prefix + "-" + place
	codes, err := s.q.ListSiteCodesWithPrefix(ctx, store.ListSiteCodesWithPrefixParams{OrganizationID: m.OrgID, Prefix: base})
	if err != nil {
		return nil, fmt.Errorf("list site codes: %w", err)
	}
	used := map[string]bool{}
	for _, c := range codes {
		used[strings.ToUpper(c)] = true
	}
	for n := 1; n <= 99; n++ {
		if c := fmt.Sprintf("%s%02d", base, n); !used[c] {
			return apigen.SuggestSiteCode200JSONResponse{Code: c}, nil
		}
	}
	return apigen.SuggestSiteCode409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã dùng hết 99 số cho địa điểm này"}}, nil
}

func (s *Server) CreateSite(ctx context.Context, req apigen.CreateSiteRequestObject) (apigen.CreateSiteResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateSite400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateSite(b.Code, b.Name, b.Kind, b.BusinessUnitId, b.Isp, b.Address, b.Timezone, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	if msg != "" {
		return apigen.CreateSite400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var (
		site                 store.GetSiteRow
		duplicate, forbidden bool
		bad                  string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		unit, msg, err := resolveUnit(ctx, q, m, f, pgtype.UUID{})
		if err != nil {
			return err
		}
		if msg != "" {
			bad = msg
			return errRollback
		}
		// Editors of the unit (organization role, partner or unit grant) add its sites; shared sites need an
		// organization-wide editor.
		if m.UnitLevel(unit.ID, unit.PartnerID) < tenant.LevelEdit {
			forbidden = true
			return errRollback
		}
		created, err := q.CreateSite(ctx, store.CreateSiteParams{
			OrganizationID: m.OrgID, Code: f.code, Name: f.name, Address: f.address, Timezone: f.timezone,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
			Kind: f.kind, BusinessUnitID: unit.ID, Isp: f.isp,
		})
		if isUniqueViolation(err) {
			duplicate = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create site: %w", err)
		}
		if site, _, err = loadSite(ctx, q, m, uuid.UUID(created.ID.Bytes)); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "site.create", ObjectType: "site", ObjectID: uuidStr(site.ID),
			After: snapSite(site), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case bad != "":
		return apigen.CreateSite400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case forbidden:
		return apigen.CreateSite403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case duplicate:
		return apigen.CreateSite409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Mã site đã tồn tại trong tổ chức"}}, nil
	case err != nil:
		return nil, err
	}
	level, err := siteLevel(ctx, s.q, m, site)
	if err != nil {
		return nil, err
	}
	return apigen.CreateSite201JSONResponse(toSite(site, 0, 0, level)), nil
}

func (s *Server) UpdateSite(ctx context.Context, req apigen.UpdateSiteRequestObject) (apigen.UpdateSiteResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdateSite400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateSite(b.Code, b.Name, b.Kind, b.BusinessUnitId, b.Isp, b.Address, b.Timezone, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	var (
		updated            store.GetSiteRow
		notFound, readOnly bool
		conflict           string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound = true
			return errRollback
		}
		level, err := siteLevel(ctx, q, m, before)
		if err != nil {
			return err
		}
		if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		if msg != "" {
			return errRollback
		}
		unit, bad, err := resolveUnit(ctx, q, m, f, before.BusinessUnitID)
		if err != nil {
			return err
		}
		if bad != "" {
			msg = bad
			return errRollback
		}
		// Moving a site needs edit rights on the units themselves (not through a share) on both sides.
		if unit.ID != before.BusinessUnitID &&
			(m.UnitLevel(before.BusinessUnitID, before.PartnerID) < tenant.LevelEdit || m.UnitLevel(unit.ID, unit.PartnerID) < tenant.LevelEdit) {
			readOnly = true
			return errRollback
		}
		_, err = q.UpdateSite(ctx, store.UpdateSiteParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Code: f.code, Name: f.name, Address: f.address,
			Timezone: f.timezone, ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
			Kind: f.kind, BusinessUnitID: unit.ID, Isp: f.isp,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Mã site đã tồn tại trong tổ chức"
			return errRollback
		case err != nil:
			return fmt.Errorf("update site: %w", err)
		}
		if updated, _, err = loadSite(ctx, q, m, req.SiteId); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "site.update", ObjectType: "site", ObjectID: uuidStr(before.ID),
			Before: snapSite(before), After: snapSite(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateSite404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	case readOnly:
		return apigen.UpdateSite403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case msg != "":
		return apigen.UpdateSite400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	case conflict != "":
		return apigen.UpdateSite409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	locs, racks, err := s.siteCounts(ctx, m, updated)
	if err != nil {
		return nil, fmt.Errorf("site counts: %w", err)
	}
	level, err := siteLevel(ctx, s.q, m, updated)
	if err != nil {
		return nil, err
	}
	return apigen.UpdateSite200JSONResponse(toSite(updated, locs, racks, level)), nil
}

func (s *Server) DeleteSite(ctx context.Context, req apigen.DeleteSiteRequestObject) (apigen.DeleteSiteResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound = true
			return errRollback
		}
		if level, err := siteLevel(ctx, q, m, before); err != nil {
			return err
		} else if level < tenant.LevelAdmin {
			forbidden = true
			return errRollback
		}
		if n, err := q.CountLiveDevicesInSite(ctx, store.CountLiveDevicesInSiteParams{OrganizationID: m.OrgID, SiteID: before.ID}); err != nil {
			return fmt.Errorf("count site devices: %w", err)
		} else if n > 0 {
			conflict = fmt.Sprintf("Site còn %d thiết bị — chuyển hoặc xóa thiết bị trước", n)
			return errRollback
		}
		if _, err := q.SoftDeleteSite(ctx, store.SoftDeleteSiteParams{ID: before.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete site: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "site.delete", ObjectType: "site", ObjectID: uuidStr(before.ID),
			Before: snapSite(before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteSite404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	case conflict != "":
		return apigen.DeleteSite409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case forbidden:
		return apigen.DeleteSite403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin tổ chức hoặc admin của đối tác/đơn vị được xóa site"}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteSite204Response{}, nil
}

// --- locations ---------------------------------------------------------------------------------------

// allowedParent encodes the location tree (ADR-025): building → floor → room; floors and rooms may also
// hang directly under the site for small sites.
func allowedParent(kind string, parentKind string) bool {
	switch kind {
	case "building":
		return parentKind == ""
	case "floor":
		return parentKind == "" || parentKind == "building"
	case "room":
		return parentKind == "" || parentKind == "building" || parentKind == "floor"
	}
	return false
}

type locationSnapshot struct {
	ParentID  string `json:"parentId,omitempty"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	SortOrder int32  `json:"sortOrder"`
}

func snapLocation(l store.Location) locationSnapshot {
	p := ""
	if l.ParentID.Valid {
		p = uuidStr(l.ParentID)
	}
	return locationSnapshot{ParentID: p, Kind: l.Kind, Name: l.Name, SortOrder: l.SortOrder}
}

func toLocation(l store.Location) apigen.Location {
	var parent *uuid.UUID
	if l.ParentID.Valid {
		p := uuid.UUID(l.ParentID.Bytes)
		parent = &p
	}
	return apigen.Location{
		Id: uuid.UUID(l.ID.Bytes), ParentId: parent, Kind: apigen.LocationKind(l.Kind), Name: l.Name,
		SortOrder: l.SortOrder, Version: l.Version,
	}
}

func validName(name string, max int) (string, bool) {
	n := strings.TrimSpace(name)
	return n, n != "" && !tooLong(n, max)
}

func (s *Server) ListLocations(ctx context.Context, req apigen.ListLocationsRequestObject) (apigen.ListLocationsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	site, ok, err := loadSite(ctx, s.q, m, req.SiteId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.ListLocations404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	}
	rows, err := s.q.ListLocations(ctx, store.ListLocationsParams{OrganizationID: m.OrgID, SiteID: site.ID})
	if err != nil {
		return nil, fmt.Errorf("list locations: %w", err)
	}
	out := apigen.LocationList{Locations: make([]apigen.Location, 0, len(rows))}
	for _, r := range rows {
		out.Locations = append(out.Locations, toLocation(r))
	}
	return apigen.ListLocations200JSONResponse(out), nil
}

func (s *Server) CreateLocation(ctx context.Context, req apigen.CreateLocationRequestObject) (apigen.CreateLocationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateLocation400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	name, nameOK := validName(req.Body.Name, 100)
	kind := string(req.Body.Kind)
	var sort int32
	if req.Body.SortOrder != nil {
		sort = *req.Body.SortOrder
	}
	var (
		created            store.Location
		notFound, readOnly bool
		bad, conflict      string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound = true
			return errRollback
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		if !nameOK {
			bad = "Tên bắt buộc, tối đa 100 ký tự"
			return errRollback
		}
		var parent pgtype.UUID
		parentKind := ""
		if req.Body.ParentId != nil {
			p, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(*req.Body.ParentId), OrganizationID: m.OrgID, SiteID: site.ID})
			if errors.Is(err, pgx.ErrNoRows) {
				bad = "Location cha không thuộc site này"
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("load parent: %w", err)
			}
			parent, parentKind = p.ID, p.Kind
		}
		if !allowedParent(kind, parentKind) {
			bad = "Sai cấp: tòa nhà nằm ngay dưới site; tầng dưới tòa nhà (hoặc site); phòng dưới tầng, tòa nhà hoặc site"
			return errRollback
		}
		created, err = q.CreateLocation(ctx, store.CreateLocationParams{
			OrganizationID: m.OrgID, SiteID: site.ID, ParentID: parent, Kind: kind, Name: name, SortOrder: sort,
		})
		if isUniqueViolation(err) {
			conflict = "Đã có location cùng tên ở cấp này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create location: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "location.create", ObjectType: "location", ObjectID: uuidStr(created.ID),
			After: snapLocation(created), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.CreateLocation404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	case readOnly:
		return apigen.CreateLocation403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case bad != "":
		return apigen.CreateLocation400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.CreateLocation409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateLocation201JSONResponse(toLocation(created)), nil
}

func (s *Server) UpdateLocation(ctx context.Context, req apigen.UpdateLocationRequestObject) (apigen.UpdateLocationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdateLocation400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	name, nameOK := validName(req.Body.Name, 100)
	var (
		updated            store.Location
		notFound, readOnly bool
		notFoundMsg        string
		bad, conflict      string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound, notFoundMsg = true, msgSiteNotFound
			return errRollback
		}
		before, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(req.LocationId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound, notFoundMsg = true, msgLocationNotFound
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load location: %w", err)
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		if !nameOK {
			bad = "Tên bắt buộc, tối đa 100 ký tự"
			return errRollback
		}
		sort := before.SortOrder
		if req.Body.SortOrder != nil {
			sort = *req.Body.SortOrder
		}
		updated, err = q.UpdateLocation(ctx, store.UpdateLocationParams{
			ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID, Name: name, SortOrder: sort, Version: req.Body.Version,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Đã có location cùng tên ở cấp này"
			return errRollback
		case err != nil:
			return fmt.Errorf("update location: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "location.update", ObjectType: "location", ObjectID: uuidStr(before.ID),
			Before: snapLocation(before), After: snapLocation(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateLocation404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: notFoundMsg}}, nil
	case readOnly:
		return apigen.UpdateLocation403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case bad != "":
		return apigen.UpdateLocation400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.UpdateLocation409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateLocation200JSONResponse(toLocation(updated)), nil
}

func (s *Server) DeleteLocation(ctx context.Context, req apigen.DeleteLocationRequestObject) (apigen.DeleteLocationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		notFound, readOnly bool
		notFoundMsg        string
		conflict           string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound, notFoundMsg = true, msgSiteNotFound
			return errRollback
		}
		before, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(req.LocationId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound, notFoundMsg = true, msgLocationNotFound
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load location: %w", err)
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		used, err := q.CountLocationChildren(ctx, store.CountLocationChildrenParams{ID: before.ID, OrganizationID: m.OrgID})
		if err != nil {
			return fmt.Errorf("count children: %w", err)
		}
		if used.Children > 0 || used.Racks > 0 {
			conflict = fmt.Sprintf("Location còn %d location con và %d rack — xóa hoặc chuyển chúng trước", used.Children, used.Racks)
			return errRollback
		}
		if n, err := q.CountLiveDevicesInLocation(ctx, store.CountLiveDevicesInLocationParams{OrganizationID: m.OrgID, LocationID: before.ID}); err != nil {
			return fmt.Errorf("count location devices: %w", err)
		} else if n > 0 {
			conflict = fmt.Sprintf("Location còn %d thiết bị — chuyển thiết bị đi trước", n)
			return errRollback
		}
		if _, err := q.DeleteLocation(ctx, store.DeleteLocationParams{ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID}); isFKViolation(err) {
			conflict = "Location đang được dùng"
			return errRollback
		} else if err != nil {
			return fmt.Errorf("delete location: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "location.delete", ObjectType: "location", ObjectID: uuidStr(before.ID),
			Before: snapLocation(before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteLocation404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: notFoundMsg}}, nil
	case readOnly:
		return apigen.DeleteLocation403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case conflict != "":
		return apigen.DeleteLocation409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteLocation204Response{}, nil
}

// --- racks -------------------------------------------------------------------------------------------

type rackSnapshot struct {
	LocationID string `json:"locationId"`
	Name       string `json:"name"`
	UHeight    int32  `json:"uHeight"`
	Notes      string `json:"notes"`
}

func snapRack(r store.Rack) rackSnapshot {
	return rackSnapshot{LocationID: uuidStr(r.LocationID), Name: r.Name, UHeight: r.UHeight, Notes: r.Notes}
}

func toRack(r store.Rack) apigen.Rack {
	return apigen.Rack{
		Id: uuid.UUID(r.ID.Bytes), LocationId: uuid.UUID(r.LocationID.Bytes), Name: r.Name, UHeight: r.UHeight,
		Notes: r.Notes, Version: r.Version,
	}
}

type rackFields struct {
	name, notes string
	uHeight     int32
}

func validateRack(name string, uHeight *int32, notes *string) (rackFields, string) {
	f := rackFields{name: strings.TrimSpace(name), notes: str(notes), uHeight: defaultRackU}
	if uHeight != nil {
		f.uHeight = *uHeight
	}
	switch {
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên rack bắt buộc, tối đa 100 ký tự"
	case f.uHeight < 1 || f.uHeight > 60:
		return f, "Số U phải từ 1 đến 60"
	case tooLong(f.notes, 2000):
		return f, "Ghi chú tối đa 2000 ký tự"
	}
	return f, ""
}

func (s *Server) ListRacks(ctx context.Context, req apigen.ListRacksRequestObject) (apigen.ListRacksResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	site, ok, err := loadSite(ctx, s.q, m, req.SiteId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.ListRacks404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	}
	rows, err := s.q.ListRacks(ctx, store.ListRacksParams{OrganizationID: m.OrgID, SiteID: site.ID})
	if err != nil {
		return nil, fmt.Errorf("list racks: %w", err)
	}
	out := apigen.RackList{Racks: make([]apigen.Rack, 0, len(rows))}
	for _, r := range rows {
		out.Racks = append(out.Racks, toRack(r))
	}
	return apigen.ListRacks200JSONResponse(out), nil
}

func (s *Server) CreateRack(ctx context.Context, req apigen.CreateRackRequestObject) (apigen.CreateRackResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateRack400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateRack(req.Body.Name, req.Body.UHeight, req.Body.Notes)
	var (
		created            store.Rack
		notFound, readOnly bool
		bad, conflict      string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound = true
			return errRollback
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		if msg != "" {
			bad = msg
			return errRollback
		}
		loc, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(req.Body.LocationId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			bad = "Location không thuộc site này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load location: %w", err)
		}
		created, err = q.CreateRack(ctx, store.CreateRackParams{
			OrganizationID: m.OrgID, SiteID: site.ID, LocationID: loc.ID, Name: f.name, UHeight: f.uHeight, Notes: f.notes,
		})
		if isUniqueViolation(err) {
			conflict = "Đã có rack cùng tên trong location này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create rack: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "rack.create", ObjectType: "rack", ObjectID: uuidStr(created.ID),
			After: snapRack(created), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.CreateRack404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgSiteNotFound}}, nil
	case readOnly:
		return apigen.CreateRack403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case bad != "":
		return apigen.CreateRack400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.CreateRack409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateRack201JSONResponse(toRack(created)), nil
}

func (s *Server) UpdateRack(ctx context.Context, req apigen.UpdateRackRequestObject) (apigen.UpdateRackResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdateRack400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateRack(req.Body.Name, req.Body.UHeight, req.Body.Notes)
	var (
		updated            store.Rack
		notFound, readOnly bool
		notFoundMsg        string
		bad, conflict      string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound, notFoundMsg = true, msgSiteNotFound
			return errRollback
		}
		before, err := q.GetRack(ctx, store.GetRackParams{ID: pgUUID(req.RackId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound, notFoundMsg = true, msgRackNotFound
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load rack: %w", err)
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		if msg != "" {
			bad = msg
			return errRollback
		}
		loc, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(req.Body.LocationId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			bad = "Location không thuộc site này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load location: %w", err)
		}
		updated, err = q.UpdateRack(ctx, store.UpdateRackParams{
			ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID, LocationID: loc.ID, Name: f.name, UHeight: f.uHeight,
			Notes: f.notes, Version: req.Body.Version,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Đã có rack cùng tên trong location này"
			return errRollback
		case err != nil:
			return fmt.Errorf("update rack: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "rack.update", ObjectType: "rack", ObjectID: uuidStr(before.ID),
			Before: snapRack(before), After: snapRack(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateRack404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: notFoundMsg}}, nil
	case readOnly:
		return apigen.UpdateRack403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case bad != "":
		return apigen.UpdateRack400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.UpdateRack409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateRack200JSONResponse(toRack(updated)), nil
}

func (s *Server) DeleteRack(ctx context.Context, req apigen.DeleteRackRequestObject) (apigen.DeleteRackResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		notFound, readOnly bool
		notFoundMsg        string
		conflict           string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		site, ok, err := loadSite(ctx, q, m, req.SiteId)
		if err != nil {
			return err
		}
		if !ok {
			notFound, notFoundMsg = true, msgSiteNotFound
			return errRollback
		}
		before, err := q.GetRack(ctx, store.GetRackParams{ID: pgUUID(req.RackId), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound, notFoundMsg = true, msgRackNotFound
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load rack: %w", err)
		}
		if level, err := siteLevel(ctx, q, m, site); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			readOnly = true
			return errRollback
		}
		// Live devices keep the rack; soft-deleted ones just lose the reference (P1-08).
		if n, err := q.CountLiveDevicesInRack(ctx, store.CountLiveDevicesInRackParams{OrganizationID: m.OrgID, RackID: before.ID}); err != nil {
			return fmt.Errorf("count rack devices: %w", err)
		} else if n > 0 {
			conflict = fmt.Sprintf("Rack còn %d thiết bị — chuyển thiết bị đi trước", n)
			return errRollback
		}
		if _, err := q.DeleteRack(ctx, store.DeleteRackParams{ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID}); isFKViolation(err) {
			conflict = "Rack còn thiết bị — chuyển thiết bị đi trước"
			return errRollback
		} else if err != nil {
			return fmt.Errorf("delete rack: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "rack.delete", ObjectType: "rack", ObjectID: uuidStr(before.ID),
			Before: snapRack(before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteRack404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: notFoundMsg}}, nil
	case readOnly:
		return apigen.DeleteRack403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case conflict != "":
		return apigen.DeleteRack409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteRack204Response{}, nil
}

func optUUID(id pgtype.UUID) *uuid.UUID {
	if !id.Valid {
		return nil
	}
	u := uuid.UUID(id.Bytes)
	return &u
}
