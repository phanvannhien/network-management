package api

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Business units (P1-07b, ADR-031): units belong to exactly one partner of the organization (fixed after
// creation) and own the sites. Organization owners/admins and the partner's partner_admins create and delete
// units; unit_admins edit their own (P1-07c). Units the caller has no access to answer 404.

const (
	msgUnitNotFound  = "Không tìm thấy đơn vị"
	msgUnitForbidden = "Chỉ owner/admin tổ chức hoặc admin của đối tác được tạo/xóa đơn vị"
	msgUnitEdit      = "Chỉ admin của tổ chức, đối tác hoặc đơn vị được sửa đơn vị"
	msgUnitDuplicate = "Mã đơn vị đã tồn tại trong đối tác"
)

type unitFields struct {
	code, name, contactName, contactPhone, contactEmail, notes string
}

func validateUnit(code, name string, contactName, contactPhone, contactEmail, notes *string) (unitFields, string) {
	f := unitFields{
		code: strings.ToUpper(strings.TrimSpace(code)), name: strings.TrimSpace(name),
		contactName: str(contactName), contactPhone: str(contactPhone), contactEmail: str(contactEmail), notes: str(notes),
	}
	switch {
	case !entityCodeRe.MatchString(f.code):
		return f, "Mã đơn vị gồm 2–8 ký tự A–Z, 0–9, bắt đầu bằng chữ (vd MAIN)"
	case f.name == "" || tooLong(f.name, 200):
		return f, "Tên đơn vị bắt buộc, tối đa 200 ký tự"
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
	PartnerID    string `json:"partnerId"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	ContactName  string `json:"contactName"`
	ContactPhone string `json:"contactPhone"`
	ContactEmail string `json:"contactEmail"`
	Notes        string `json:"notes"`
}

func snapUnit(u store.BusinessUnit) unitSnapshot {
	return unitSnapshot{uuidStr(u.PartnerID), u.Code, u.Name, u.ContactName, u.ContactPhone, u.ContactEmail, u.Notes}
}

func unitFromRow(r store.GetBusinessUnitRow) store.BusinessUnit {
	return store.BusinessUnit{
		ID: r.ID, OrganizationID: r.OrganizationID, PartnerID: r.PartnerID, Code: r.Code, Name: r.Name,
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, Notes: r.Notes,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, Version: r.Version,
	}
}

func toUnit(u store.BusinessUnit, partnerCode, partnerName string, sites int64, level int) apigen.BusinessUnit {
	return apigen.BusinessUnit{
		Id: uuid.UUID(u.ID.Bytes), PartnerId: uuid.UUID(u.PartnerID.Bytes), PartnerCode: partnerCode, PartnerName: partnerName,
		Code: u.Code, Name: u.Name, ContactName: u.ContactName, ContactPhone: u.ContactPhone, ContactEmail: u.ContactEmail,
		Notes: u.Notes, SiteCount: sites, Access: levelName(level), Version: u.Version, CreatedAt: u.CreatedAt.Time,
	}
}

func (s *Server) ListBusinessUnits(ctx context.Context, req apigen.ListBusinessUnitsRequestObject) (apigen.ListBusinessUnitsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	params := store.ListBusinessUnitsParams{OrganizationID: m.OrgID}
	if req.Params.PartnerId != nil {
		params.PartnerFilter = pgUUID(*req.Params.PartnerId)
	}
	rows, err := s.q.ListBusinessUnits(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list business units: %w", err)
	}
	out := apigen.BusinessUnitList{BusinessUnits: make([]apigen.BusinessUnit, 0, len(rows))}
	for _, r := range rows {
		if level := m.UnitLevel(r.ID, r.PartnerID); level > tenant.LevelNone {
			out.BusinessUnits = append(out.BusinessUnits, toUnit(unitFromRow(store.GetBusinessUnitRow(r)), r.PartnerCode, r.PartnerName, r.SiteCount, level))
		}
	}
	return apigen.ListBusinessUnits200JSONResponse(out), nil
}

func (s *Server) GetBusinessUnit(ctx context.Context, req apigen.GetBusinessUnitRequestObject) (apigen.GetBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	r, err := s.q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(req.BusinessUnitId), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.UnitLevel(r.ID, r.PartnerID) == tenant.LevelNone) {
		return apigen.GetBusinessUnit404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgUnitNotFound}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get business unit: %w", err)
	}
	return apigen.GetBusinessUnit200JSONResponse(toUnit(unitFromRow(r), r.PartnerCode, r.PartnerName, r.SiteCount, m.UnitLevel(r.ID, r.PartnerID))), nil
}

func (s *Server) CreateBusinessUnit(ctx context.Context, req apigen.CreateBusinessUnitRequestObject) (apigen.CreateBusinessUnitResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateUnit(b.Code, b.Name, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	if msg != "" {
		return apigen.CreateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var (
		unit                            store.BusinessUnit
		partner                         store.GetPartnerRow
		duplicate, noPartner, forbidden bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		// The partner must be a live partner of this organization (the composite FK backs this up).
		partner, err = q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(b.PartnerId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			noPartner = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load partner: %w", err)
		}
		if m.PartnerLevel(partner.ID) < tenant.LevelAdmin {
			forbidden = true
			return errRollback
		}
		unit, err = q.CreateBusinessUnit(ctx, store.CreateBusinessUnitParams{
			OrganizationID: m.OrgID, PartnerID: partner.ID, Code: f.code, Name: f.name,
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
	switch {
	case noPartner:
		return apigen.CreateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msgPartnerNotFound}}, nil
	case forbidden:
		return apigen.CreateBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgUnitForbidden}}, nil
	case duplicate:
		return apigen.CreateBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgUnitDuplicate}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateBusinessUnit201JSONResponse(toUnit(unit, partner.Code, partner.Name, 0, m.UnitLevel(unit.ID, unit.PartnerID))), nil
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
	f, msg := validateUnit(b.Code, b.Name, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	var (
		updated             store.BusinessUnit
		before              store.GetBusinessUnitRow
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err = q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(req.BusinessUnitId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.UnitLevel(before.ID, before.PartnerID) == tenant.LevelNone) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load business unit: %w", err)
		}
		if m.UnitLevel(before.ID, before.PartnerID) < tenant.LevelAdmin {
			forbidden = true
			return errRollback
		}
		if msg != "" {
			return errRollback
		}
		// The unit code is not part of site codes (ADR-031), so renaming it touches nothing else.
		updated, err = q.UpdateBusinessUnit(ctx, store.UpdateBusinessUnitParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Code: f.code, Name: f.name,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = msgUnitDuplicate
			return errRollback
		case err != nil:
			return fmt.Errorf("update business unit: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "business_unit.update", ObjectType: "business_unit",
			ObjectID: uuidStr(before.ID), Before: snapUnit(unitFromRow(before)), After: snapUnit(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateBusinessUnit404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgUnitNotFound}}, nil
	case forbidden:
		return apigen.UpdateBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgUnitEdit}}, nil
	case msg != "":
		return apigen.UpdateBusinessUnit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	case conflict != "":
		return apigen.UpdateBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateBusinessUnit200JSONResponse(toUnit(updated, before.PartnerCode, before.PartnerName, before.SiteCount, m.UnitLevel(updated.ID, updated.PartnerID))), nil
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
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.UnitLevel(before.ID, before.PartnerID) == tenant.LevelNone) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load business unit: %w", err)
		}
		if m.PartnerLevel(before.PartnerID) < tenant.LevelAdmin {
			forbidden = true
			return errRollback
		}
		if before.SiteCount > 0 {
			conflict = fmt.Sprintf("Đơn vị còn %d site — chuyển hoặc xóa các site trước", before.SiteCount)
			return errRollback
		}
		// Devices of the unit may sit in shared sites (ADR-026).
		if n, err := q.CountLiveDevicesOfUnit(ctx, store.CountLiveDevicesOfUnitParams{OrganizationID: m.OrgID, BusinessUnitID: before.ID}); err != nil {
			return fmt.Errorf("count unit devices: %w", err)
		} else if n > 0 {
			conflict = fmt.Sprintf("Đơn vị còn %d thiết bị — chuyển hoặc xóa thiết bị trước", n)
			return errRollback
		}
		if n, err := q.CountEndpointGroupsOfUnit(ctx, store.CountEndpointGroupsOfUnitParams{OrganizationID: m.OrgID, BusinessUnitID: before.ID}); err != nil {
			return fmt.Errorf("count unit endpoint groups: %w", err)
		} else if n > 0 {
			conflict = fmt.Sprintf("Đơn vị còn %d nhóm thiết bị đầu cuối — chuyển hoặc xóa trước", n)
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
		return apigen.DeleteBusinessUnit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgUnitForbidden}}, nil
	case conflict != "":
		return apigen.DeleteBusinessUnit409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteBusinessUnit204Response{}, nil
}
