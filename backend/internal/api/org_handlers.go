package api

import (
	"context"
	"errors"
	"fmt"
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

const (
	maxOrgName  = 200
	maxOrgNotes = 2000
)

// orgSnapshot is what audit before/after records for an organization.
type orgSnapshot struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Notes string `json:"notes"`
}

func snapshot(o store.Organization) orgSnapshot {
	return orgSnapshot{Name: o.Name, Kind: o.Kind, Notes: o.Notes}
}

// validateOrgFields trims and checks name/notes; returns a user-facing message when invalid.
func validateOrgFields(name, notes string) (string, string, string) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", "", "Tên tổ chức không được để trống"
	case utf8.RuneCountInString(name) > maxOrgName:
		return "", "", fmt.Sprintf("Tên tổ chức tối đa %d ký tự", maxOrgName)
	case utf8.RuneCountInString(notes) > maxOrgNotes:
		return "", "", fmt.Sprintf("Ghi chú tối đa %d ký tự", maxOrgNotes)
	}
	return name, notes, ""
}

func toOrganization(o store.Organization) apigen.Organization {
	return apigen.Organization{
		Id: uuid.UUID(o.ID.Bytes), Name: o.Name, Kind: apigen.OrganizationKind(o.Kind), Notes: o.Notes,
		Version: o.Version, CreatedAt: o.CreatedAt.Time, UpdatedAt: o.UpdatedAt.Time,
	}
}

func toView(o store.Organization, m tenant.Membership) apigen.OrganizationView {
	perms := m.Permissions
	if perms == nil {
		perms = []string{}
	}
	return apigen.OrganizationView{
		Organization: toOrganization(o),
		Membership:   apigen.MembershipInfo{Role: apigen.Role(m.Role), Permissions: perms},
	}
}

// ListMyOrganizations returns the organizations the caller is a member of.
func (s *Server) ListMyOrganizations(ctx context.Context, _ apigen.ListMyOrganizationsRequestObject) (apigen.ListMyOrganizationsResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.ListMyOrganizations401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgNotSignedIn}}, nil
	}
	rows, err := s.q.ListMyOrganizations(ctx, sess.UserID)
	if err != nil {
		return nil, fmt.Errorf("list my organizations: %w", err)
	}
	out := apigen.MyOrganizations{Organizations: make([]apigen.OrganizationSummary, 0, len(rows))}
	for _, r := range rows {
		out.Organizations = append(out.Organizations, apigen.OrganizationSummary{
			Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Kind: apigen.OrganizationKind(r.Kind), Role: apigen.Role(r.Role),
		})
	}
	return apigen.ListMyOrganizations200JSONResponse(out), nil
}

// GetOrganization returns the organization named in the path (membership checked by tenant middleware).
func (s *Server) GetOrganization(ctx context.Context, req apigen.GetOrganizationRequestObject) (apigen.GetOrganizationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	org, err := s.q.GetOrganization(ctx, m.OrgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.GetOrganization404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy tổ chức"}}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get organization: %w", err)
	}
	return apigen.GetOrganization200JSONResponse(toView(org, m)), nil
}

// UpdateOrganization renames / edits notes (owner, admin) with an optimistic lock.
func (s *Server) UpdateOrganization(ctx context.Context, req apigen.UpdateOrganizationRequestObject) (apigen.UpdateOrganizationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.UpdateOrganization403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được sửa thông tin tổ chức"}}, nil
	}
	if req.Body == nil {
		return apigen.UpdateOrganization400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	name, notes, msg := validateOrgFields(req.Body.Name, req.Body.Notes)
	if msg != "" {
		return apigen.UpdateOrganization400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}

	var updated store.Organization
	conflict := false
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetOrganization(ctx, m.OrgID)
		if err != nil {
			return fmt.Errorf("load organization: %w", err)
		}
		updated, err = q.UpdateOrganization(ctx, store.UpdateOrganizationParams{
			ID: m.OrgID, Name: name, Notes: notes, Version: req.Body.Version,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			conflict = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update organization: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "organization.update",
			ObjectType: "organization", ObjectID: uuidStr(m.OrgID),
			Before: snapshot(before), After: snapshot(updated), Meta: infoFrom(ctx).meta,
		})
	})
	if conflict {
		return apigen.UpdateOrganization409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{
			Message: "Tổ chức vừa được người khác sửa. Tải lại để xem bản mới nhất rồi sửa lại.",
		}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.UpdateOrganization200JSONResponse(toView(updated, m)), nil
}

// ActivateOrganization remembers the organization as the default after sign-in.
func (s *Server) ActivateOrganization(ctx context.Context, req apigen.ActivateOrganizationRequestObject) (apigen.ActivateOrganizationResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sess, _ := sessionFrom(ctx) // tenant middleware already required a session
	if err := s.q.SetSessionActiveOrganization(ctx, store.SetSessionActiveOrganizationParams{
		TokenHash: sess.TokenHash, ActiveOrganizationID: m.OrgID,
	}); err != nil {
		return nil, fmt.Errorf("set active organization: %w", err)
	}
	return apigen.ActivateOrganization204Response{}, nil
}

// --- System admin (route gated by requireSystemAdmin) ---

func toAdminOrganization(id pgtype.UUID, name, kind, notes string, members, units, sites int64, created pgtype.Timestamptz, version int32) apigen.AdminOrganization {
	return apigen.AdminOrganization{
		Id: uuid.UUID(id.Bytes), Name: name, Kind: apigen.OrganizationKind(kind), Notes: notes,
		MemberCount: members, UnitCount: units, SiteCount: sites, CreatedAt: created.Time, Version: version,
	}
}

// AdminListOrganizations lists every live organization.
func (s *Server) AdminListOrganizations(ctx context.Context, _ apigen.AdminListOrganizationsRequestObject) (apigen.AdminListOrganizationsResponseObject, error) {
	rows, err := s.q.AdminListOrganizations(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin list organizations: %w", err)
	}
	out := apigen.AdminOrganizationList{Organizations: make([]apigen.AdminOrganization, 0, len(rows))}
	for _, r := range rows {
		out.Organizations = append(out.Organizations, toAdminOrganization(r.ID, r.Name, r.Kind, r.Notes, r.MemberCount, r.UnitCount, r.SiteCount, r.CreatedAt, r.Version))
	}
	return apigen.AdminListOrganizations200JSONResponse(out), nil
}

// AdminCreateOrganization creates an organization, by default with the caller as owner.
func (s *Server) AdminCreateOrganization(ctx context.Context, req apigen.AdminCreateOrganizationRequestObject) (apigen.AdminCreateOrganizationResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	if req.Body == nil {
		return apigen.AdminCreateOrganization400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	notes := ""
	if req.Body.Notes != nil {
		notes = *req.Body.Notes
	}
	name, notes, msg := validateOrgFields(req.Body.Name, notes)
	if msg == "" && !req.Body.Kind.Valid() {
		msg = "Loại tổ chức không hợp lệ"
	}
	if msg != "" {
		return apigen.AdminCreateOrganization400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	addOwner := req.Body.AddMeAsOwner == nil || *req.Body.AddMeAsOwner

	var org store.Organization
	members := int64(0)
	err := s.withTx(ctx, func(q store.Querier) error {
		var err error
		org, err = q.CreateOrganization(ctx, store.CreateOrganizationParams{Name: name, Kind: string(req.Body.Kind), Notes: notes})
		if err != nil {
			return fmt.Errorf("create organization: %w", err)
		}
		if addOwner {
			if _, err := q.AddMembership(ctx, store.AddMembershipParams{
				OrganizationID: org.ID, UserID: sess.UserID, Role: tenant.RoleOwner,
			}); err != nil {
				return fmt.Errorf("add owner: %w", err)
			}
			members = 1
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: org.ID, Actor: sess.UserID, Action: "organization.create",
			ObjectType: "organization", ObjectID: uuidStr(org.ID),
			After: snapshot(org), Meta: infoFrom(ctx).meta,
		})
	})
	if err != nil {
		return nil, err
	}
	return apigen.AdminCreateOrganization201JSONResponse(
		toAdminOrganization(org.ID, org.Name, org.Kind, org.Notes, members, 0, 0, org.CreatedAt, org.Version)), nil
}

// AdminDeleteOrganization soft-deletes an organization (ADR-022): it disappears for everyone, history stays.
func (s *Server) AdminDeleteOrganization(ctx context.Context, req apigen.AdminDeleteOrganizationRequestObject) (apigen.AdminDeleteOrganizationResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	id := pgtype.UUID{Bytes: req.OrgId, Valid: true}
	notFound := false
	err := s.withTx(ctx, func(q store.Querier) error {
		org, err := q.SoftDeleteOrganization(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("soft delete organization: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: id, Actor: sess.UserID, Action: "organization.delete",
			ObjectType: "organization", ObjectID: uuidStr(id),
			Before: snapshot(org), Meta: infoFrom(ctx).meta,
		})
	})
	if notFound {
		return apigen.AdminDeleteOrganization404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy tổ chức"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.AdminDeleteOrganization204Response{}, nil
}

func uuidStr(id pgtype.UUID) string { return uuid.UUID(id.Bytes).String() }
