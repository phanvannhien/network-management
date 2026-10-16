package api

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Business units (P1-07, ADR-026): the organization's subsidiaries / partners / customers, each with its
// own sites. Managed by organization owners/admins (unit admins arrive with ADR-029, P1-07c).

var (
	unitCodeRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,7}$`)
	relations  = []string{"subsidiary", "partner", "customer"}
)

const msgUnitNotFound = "Không tìm thấy đơn vị"

type unitFields struct {
	code, name, relation, contactName, contactPhone, contactEmail, notes string
}

func validateUnit(code, name string, relation *apigen.BusinessUnitRelation, contactName, contactPhone, contactEmail, notes *string) (unitFields, string) {
	f := unitFields{
		code: strings.ToUpper(strings.TrimSpace(code)), name: strings.TrimSpace(name), relation: "subsidiary",
		contactName: str(contactName), contactPhone: str(contactPhone), contactEmail: str(contactEmail), notes: str(notes),
	}
	if relation != nil {
		f.relation = string(*relation)
	}
	switch {
	case !unitCodeRe.MatchString(f.code):
		return f, "Mã đơn vị gồm 2–8 ký tự A–Z, 0–9, bắt đầu bằng chữ (vd AGRI)"
	case f.code == sharedPrefix:
		return f, "SHARED là tiền tố dành cho site dùng chung, không dùng làm mã đơn vị"
	case f.name == "" || tooLong(f.name, 200):
		return f, "Tên đơn vị bắt buộc, tối đa 200 ký tự"
	case !slices.Contains(relations, f.relation):
		return f, "Loại quan hệ không hợp lệ"
	case tooLong(f.contactName, 200) || tooLong(f.contactPhone, 50) || tooLong(f.notes, 2000):
		return f, "Một trường vượt quá độ dài cho phép"
	}
	if f.contactEmail != "" {
		if a, err := mail.ParseAddress(f.contactEmail); err != nil || a.Address != f.contactEmail || tooLong(f.contactEmail, 320) {
			return f, "Email liên hệ không hợp lệ"
		}
	}
	return f, ""
}

type unitSnapshot struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Relation     string `json:"relation"`
	ContactName  string `json:"contactName"`
	ContactPhone string `json:"contactPhone"`
	ContactEmail string `json:"contactEmail"`
	Notes        string `json:"notes"`
}

func snapUnit(u store.BusinessUnit) unitSnapshot {
	return unitSnapshot{u.Code, u.Name, u.Relation, u.ContactName, u.ContactPhone, u.ContactEmail, u.Notes}
}

func unitFromRow(r store.GetBusinessUnitRow) store.BusinessUnit {
	return store.BusinessUnit{
		ID: r.ID, OrganizationID: r.OrganizationID, Code: r.Code, Name: r.Name, Relation: r.Relation,
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, Notes: r.Notes,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, Version: r.Version,
	}
}

func toUnit(u store.BusinessUnit, sites int64) apigen.BusinessUnit {
	return apigen.BusinessUnit{
		Id: uuid.UUID(u.ID.Bytes), Code: u.Code, Name: u.Name, Relation: apigen.BusinessUnitRelation(u.Relation),
		ContactName: u.ContactName, ContactPhone: u.ContactPhone, ContactEmail: u.ContactEmail, Notes: u.Notes,
		SiteCount: sites, Version: u.Version, CreatedAt: u.CreatedAt.Time,
	}
}

func (s *Server) ListBusinessUnits(ctx context.Context, req apigen.ListBusinessUnitsRequestObject) (apigen.ListBusinessUnitsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListBusinessUnits(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("list business units: %w", err)
	}
	out := apigen.BusinessUnitList{BusinessUnits: make([]apigen.BusinessUnit, 0, len(rows))}
	for _, r := range rows {
		out.BusinessUnits = append(out.BusinessUnits, toUnit(unitFromRow(store.GetBusinessUnitRow(r)), r.SiteCount))
	}
	return apigen.ListBusinessUnits200JSONResponse(out), nil
}

func (s *Server) GetBusinessUnit(ctx context.Context, req apigen.GetBusinessUnitRequestObject) (apigen.GetBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	r, err := s.q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(req.BusinessUnitId), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.GetBusinessUnit404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgUnitNotFound}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get business unit: %w", err)
	}
	return apigen.GetBusinessUnit200JSONResponse(toUnit(unitFromRow(r), r.SiteCount)), nil
}

func (s *Server) CreateBusinessUnit(ctx context.Context, req apigen.CreateBusinessUnitRequestObject) (apigen.CreateBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.CreateBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đơn vị"}}, nil
	}
	if req.Body == nil {
		return apigen.CreateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateUnit(b.Code, b.Name, b.Relation, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	if msg != "" {
		return apigen.CreateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var (
		unit      store.BusinessUnit
		duplicate bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		unit, err = q.CreateBusinessUnit(ctx, store.CreateBusinessUnitParams{
			OrganizationID: m.OrgID, Code: f.code, Name: f.name, Relation: f.relation,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
		})
		if isUniqueViolation(err) {
			duplicate = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create business unit: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "business_unit.create", ObjectType: "business_unit",
			ObjectID: uuidStr(unit.ID), After: snapUnit(unit), Meta: infoFrom(ctx).meta,
		})
	})
	if duplicate {
		return apigen.CreateBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Mã đơn vị đã tồn tại trong tổ chức"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.CreateBusinessUnit201JSONResponse(toUnit(unit, 0)), nil
}

func (s *Server) UpdateBusinessUnit(ctx context.Context, req apigen.UpdateBusinessUnitRequestObject) (apigen.UpdateBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateUnit(b.Code, b.Name, b.Relation, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	var (
		updated             store.BusinessUnit
		sites               int64
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(req.BusinessUnitId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load business unit: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		if msg != "" {
			return errRollback
		}
		updated, err = q.UpdateBusinessUnit(ctx, store.UpdateBusinessUnitParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Code: f.code, Name: f.name, Relation: f.relation,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Mã đơn vị đã tồn tại trong tổ chức"
			return errRollback
		case err != nil:
			return fmt.Errorf("update business unit: %w", err)
		}
		after := map[string]any{"unit": snapUnit(updated)}
		if updated.Code != before.Code {
			// ADR-030: site codes carry the unit code — rename their prefix in the same transaction.
			n, err := q.RenameUnitSitePrefix(ctx, store.RenameUnitSitePrefixParams{
				OrganizationID: m.OrgID, ID: before.ID, OldCode: before.Code, NewCode: updated.Code,
			})
			if isUniqueViolation(err) {
				conflict = "Đổi mã làm trùng mã site đang có"
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("rename site codes: %w", err)
			}
			after["renamedSites"] = n
		}
		sites = before.SiteCount
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "business_unit.update", ObjectType: "business_unit",
			ObjectID: uuidStr(before.ID), Before: snapUnit(unitFromRow(before)), After: after, Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateBusinessUnit404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgUnitNotFound}}, nil
	case forbidden:
		return apigen.UpdateBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đơn vị"}}, nil
	case msg != "":
		return apigen.UpdateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	case conflict != "":
		return apigen.UpdateBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateBusinessUnit200JSONResponse(toUnit(updated, sites)), nil
}

func (s *Server) DeleteBusinessUnit(ctx context.Context, req apigen.DeleteBusinessUnitRequestObject) (apigen.DeleteBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(req.BusinessUnitId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load business unit: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		if before.SiteCount > 0 {
			conflict = fmt.Sprintf("Đơn vị còn %d site — chuyển hoặc xóa các site trước", before.SiteCount)
			return errRollback
		}
		if _, err := q.SoftDeleteBusinessUnit(ctx, store.SoftDeleteBusinessUnitParams{ID: before.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete business unit: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "business_unit.delete", ObjectType: "business_unit",
			ObjectID: uuidStr(before.ID), Before: snapUnit(unitFromRow(before)), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteBusinessUnit404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgUnitNotFound}}, nil
	case forbidden:
		return apigen.DeleteBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đơn vị"}}, nil
	case conflict != "":
		return apigen.DeleteBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteBusinessUnit204Response{}, nil
}
