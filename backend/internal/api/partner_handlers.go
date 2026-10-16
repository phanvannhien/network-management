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

// Partners (P1-07b, ADR-031): the organization's subsidiaries / partners / customers; each has business units,
// which own the sites. Managed by organization owners/admins (partner admins arrive with P1-07c).

var (
	entityCodeRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,7}$`)
	relations    = []string{"subsidiary", "partner", "customer"}
)

const msgPartnerNotFound = "Không tìm thấy đối tác"

type partnerFields struct {
	code, name, relation, contactName, contactPhone, contactEmail, notes string
}

func validatePartner(code, name string, relation *apigen.PartnerRelation, contactName, contactPhone, contactEmail, notes *string) (partnerFields, string) {
	f := partnerFields{
		code: strings.ToUpper(strings.TrimSpace(code)), name: strings.TrimSpace(name), relation: "subsidiary",
		contactName: str(contactName), contactPhone: str(contactPhone), contactEmail: str(contactEmail), notes: str(notes),
	}
	if relation != nil {
		f.relation = string(*relation)
	}
	switch {
	case !entityCodeRe.MatchString(f.code):
		return f, "Mã đối tác gồm 2–8 ký tự A–Z, 0–9, bắt đầu bằng chữ (vd AGRI)"
	case f.code == sharedPrefix:
		return f, "SHARED là tiền tố dành cho site dùng chung, không dùng làm mã đối tác"
	case f.name == "" || tooLong(f.name, 200):
		return f, "Tên đối tác bắt buộc, tối đa 200 ký tự"
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

type partnerSnapshot struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Relation     string `json:"relation"`
	ContactName  string `json:"contactName"`
	ContactPhone string `json:"contactPhone"`
	ContactEmail string `json:"contactEmail"`
	Notes        string `json:"notes"`
}

func snapPartner(u store.Partner) partnerSnapshot {
	return partnerSnapshot{u.Code, u.Name, u.Relation, u.ContactName, u.ContactPhone, u.ContactEmail, u.Notes}
}

func partnerFromRow(r store.GetPartnerRow) store.Partner {
	return store.Partner{
		ID: r.ID, OrganizationID: r.OrganizationID, Code: r.Code, Name: r.Name, Relation: r.Relation,
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, Notes: r.Notes,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, Version: r.Version,
	}
}

func toPartner(u store.Partner, units, sites int64) apigen.Partner {
	return apigen.Partner{
		Id: uuid.UUID(u.ID.Bytes), Code: u.Code, Name: u.Name, Relation: apigen.PartnerRelation(u.Relation),
		ContactName: u.ContactName, ContactPhone: u.ContactPhone, ContactEmail: u.ContactEmail, Notes: u.Notes,
		UnitCount: units, SiteCount: sites, Version: u.Version, CreatedAt: u.CreatedAt.Time,
	}
}

func (s *Server) ListPartners(ctx context.Context, req apigen.ListPartnersRequestObject) (apigen.ListPartnersResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPartners(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("list partners: %w", err)
	}
	out := apigen.PartnerList{Partners: make([]apigen.Partner, 0, len(rows))}
	for _, r := range rows {
		out.Partners = append(out.Partners, toPartner(partnerFromRow(store.GetPartnerRow(r)), r.UnitCount, r.SiteCount))
	}
	return apigen.ListPartners200JSONResponse(out), nil
}

func (s *Server) GetPartner(ctx context.Context, req apigen.GetPartnerRequestObject) (apigen.GetPartnerResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	r, err := s.q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(req.PartnerId), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.GetPartner404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgPartnerNotFound}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get partner: %w", err)
	}
	return apigen.GetPartner200JSONResponse(toPartner(partnerFromRow(r), r.UnitCount, r.SiteCount)), nil
}

func (s *Server) CreatePartner(ctx context.Context, req apigen.CreatePartnerRequestObject) (apigen.CreatePartnerResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.CreatePartner403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đối tác"}}, nil
	}
	if req.Body == nil {
		return apigen.CreatePartner400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validatePartner(b.Code, b.Name, b.Relation, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	if msg != "" {
		return apigen.CreatePartner400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var (
		unit      store.Partner
		duplicate bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		unit, err = q.CreatePartner(ctx, store.CreatePartnerParams{
			OrganizationID: m.OrgID, Code: f.code, Name: f.name, Relation: f.relation,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
		})
		if isUniqueViolation(err) {
			duplicate = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create partner: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "partner.create", ObjectType: "partner",
			ObjectID: uuidStr(unit.ID), After: snapPartner(unit), Meta: infoFrom(ctx).meta,
		})
	})
	if duplicate {
		return apigen.CreatePartner409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Mã đối tác đã tồn tại trong tổ chức"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.CreatePartner201JSONResponse(toPartner(unit, 0, 0)), nil
}

func (s *Server) UpdatePartner(ctx context.Context, req apigen.UpdatePartnerRequestObject) (apigen.UpdatePartnerResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdatePartner400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validatePartner(b.Code, b.Name, b.Relation, b.ContactName, b.ContactPhone, b.ContactEmail, b.Notes)
	var (
		updated             store.Partner
		units, sites        int64
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(req.PartnerId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load partner: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		if msg != "" {
			return errRollback
		}
		updated, err = q.UpdatePartner(ctx, store.UpdatePartnerParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Code: f.code, Name: f.name, Relation: f.relation,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Mã đối tác đã tồn tại trong tổ chức"
			return errRollback
		case err != nil:
			return fmt.Errorf("update partner: %w", err)
		}
		after := map[string]any{"partner": snapPartner(updated)}
		if updated.Code != before.Code {
			// ADR-031: site codes carry the partner code — rename their prefix in the same transaction.
			n, err := q.RenamePartnerSitePrefix(ctx, store.RenamePartnerSitePrefixParams{
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
		units, sites = before.UnitCount, before.SiteCount
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "partner.update", ObjectType: "partner",
			ObjectID: uuidStr(before.ID), Before: snapPartner(partnerFromRow(before)), After: after, Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdatePartner404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgPartnerNotFound}}, nil
	case forbidden:
		return apigen.UpdatePartner403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đối tác"}}, nil
	case msg != "":
		return apigen.UpdatePartner400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	case conflict != "":
		return apigen.UpdatePartner409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdatePartner200JSONResponse(toPartner(updated, units, sites)), nil
}

func (s *Server) DeletePartner(ctx context.Context, req apigen.DeletePartnerRequestObject) (apigen.DeletePartnerResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(req.PartnerId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load partner: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		if before.UnitCount > 0 {
			conflict = fmt.Sprintf("Đối tác còn %d đơn vị — xóa các đơn vị trước", before.UnitCount)
			return errRollback
		}
		if _, err := q.SoftDeletePartner(ctx, store.SoftDeletePartnerParams{ID: before.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete partner: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "partner.delete", ObjectType: "partner",
			ObjectID: uuidStr(before.ID), Before: snapPartner(partnerFromRow(before)), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeletePartner404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgPartnerNotFound}}, nil
	case forbidden:
		return apigen.DeletePartner403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được quản lý đối tác"}}, nil
	case conflict != "":
		return apigen.DeletePartner409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeletePartner204Response{}, nil
}
