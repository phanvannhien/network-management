package api

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Partner / unit grants (P1-07c, ADR-031). Admins of the scope (organization owner/admin, the partner's
// partner_admin, or for a unit also its unit_admin) invite users by email — new emails get a one-time invite
// link, existing users join the organization with role "member" if they were not in it — and change or
// revoke their grant. Grants never touch organization roles.

const (
	msgGrantDuplicate = "Người này đã được cấp quyền ở đây"
	msgGrantNotFound  = "Không tìm thấy quyền đã cấp"
	msgGrantStale     = "Quyền vừa được người khác sửa. Tải lại rồi thử lại."
)

// grantScope abstracts the two grant tables so the invite flow is written once.
type grantScope struct {
	level  string // "partner" | "business_unit" (audit meta key)
	id     pgtype.UUID
	get    func(ctx context.Context, q store.Querier, user pgtype.UUID) (store.GetPartnerMemberRow, error)
	add    func(ctx context.Context, q store.Querier, user pgtype.UUID, role string) error
	update func(ctx context.Context, q store.Querier, user pgtype.UUID, role string, version int32) (int64, error)
	remove func(ctx context.Context, q store.Querier, user pgtype.UUID) (int64, error)
}

type grantSnapshot struct {
	Email   string `json:"email"`
	Partner string `json:"partnerId,omitempty"`
	Unit    string `json:"businessUnitId,omitempty"`
	Role    string `json:"role"`
	Invited bool   `json:"invited,omitempty"`
}

func (g grantScope) snapshot(email, role string) grantSnapshot {
	snap := grantSnapshot{Email: email, Role: role}
	if g.level == "partner" {
		snap.Partner = uuidStr(g.id)
	} else {
		snap.Unit = uuidStr(g.id)
	}
	return snap
}

func toGrantMember(r store.GetPartnerMemberRow) apigen.GrantMember {
	return apigen.GrantMember{
		UserId: uuid.UUID(r.UserID.Bytes), Email: r.Email, DisplayName: r.DisplayName, Role: r.Role,
		PendingInvite: r.PendingInvite, Version: r.Version, CreatedAt: r.CreatedAt.Time,
	}
}

func partnerScope(m tenant.Membership, partner pgtype.UUID) grantScope {
	return grantScope{
		level: "partner", id: partner,
		get: func(ctx context.Context, q store.Querier, user pgtype.UUID) (store.GetPartnerMemberRow, error) {
			return q.GetPartnerMember(ctx, store.GetPartnerMemberParams{OrganizationID: m.OrgID, PartnerID: partner, UserID: user})
		},
		add: func(ctx context.Context, q store.Querier, user pgtype.UUID, role string) error {
			return q.AddPartnerMember(ctx, store.AddPartnerMemberParams{OrganizationID: m.OrgID, PartnerID: partner, UserID: user, Role: role, GrantedBy: m.UserID})
		},
		update: func(ctx context.Context, q store.Querier, user pgtype.UUID, role string, version int32) (int64, error) {
			return q.UpdatePartnerMember(ctx, store.UpdatePartnerMemberParams{OrganizationID: m.OrgID, PartnerID: partner, UserID: user, Role: role, Version: version})
		},
		remove: func(ctx context.Context, q store.Querier, user pgtype.UUID) (int64, error) {
			return q.DeletePartnerMember(ctx, store.DeletePartnerMemberParams{OrganizationID: m.OrgID, PartnerID: partner, UserID: user})
		},
	}
}

func unitScope(m tenant.Membership, unit pgtype.UUID) grantScope {
	return grantScope{
		level: "business_unit", id: unit,
		get: func(ctx context.Context, q store.Querier, user pgtype.UUID) (store.GetPartnerMemberRow, error) {
			r, err := q.GetUnitMember(ctx, store.GetUnitMemberParams{OrganizationID: m.OrgID, BusinessUnitID: unit, UserID: user})
			return store.GetPartnerMemberRow(r), err
		},
		add: func(ctx context.Context, q store.Querier, user pgtype.UUID, role string) error {
			return q.AddUnitMember(ctx, store.AddUnitMemberParams{OrganizationID: m.OrgID, BusinessUnitID: unit, UserID: user, Role: role, GrantedBy: m.UserID})
		},
		update: func(ctx context.Context, q store.Querier, user pgtype.UUID, role string, version int32) (int64, error) {
			return q.UpdateUnitMember(ctx, store.UpdateUnitMemberParams{OrganizationID: m.OrgID, BusinessUnitID: unit, UserID: user, Role: role, Version: version})
		},
		remove: func(ctx context.Context, q store.Querier, user pgtype.UUID) (int64, error) {
			return q.DeleteUnitMember(ctx, store.DeleteUnitMemberParams{OrganizationID: m.OrgID, BusinessUnitID: unit, UserID: user})
		},
	}
}

// grantOutcome carries the user-facing result of a grant operation.
type grantOutcome struct {
	member   store.GetPartnerMemberRow
	token    *string
	bad      string
	conflict string
	notFound bool
}

// addGrant runs the invite flow for one scope inside a transaction.
func (s *Server) addGrant(ctx context.Context, m tenant.Membership, g grantScope, rawEmail, role string) (grantOutcome, error) {
	var out grantOutcome
	email := strings.TrimSpace(rawEmail)
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email || len(email) > 320 {
		out.bad = "Email không hợp lệ"
		return out, nil
	}
	err := s.withTx(ctx, func(q store.Querier) error {
		user, err := q.GetUserByEmail(ctx, email)
		invited := false
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if user, err = q.CreateInvitedUser(ctx, email); err != nil {
				return fmt.Errorf("create invited user: %w", err)
			}
			invited = true
		case err != nil:
			return fmt.Errorf("load user: %w", err)
		case user.PasswordHash == "":
			// A pending invite is only reused when it belongs to this organization (same rule as AddMember).
			if _, err := q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: user.ID}); errors.Is(err, pgx.ErrNoRows) {
				out.conflict = "Email này đang chờ kích hoạt từ một lời mời khác. Hãy thêm lại sau khi người đó kích hoạt tài khoản."
				return errRollback
			} else if err != nil {
				return fmt.Errorf("check membership: %w", err)
			}
		}
		joined, err := q.EnsureMembership(ctx, store.EnsureMembershipParams{OrganizationID: m.OrgID, UserID: user.ID})
		if err != nil {
			return fmt.Errorf("ensure membership: %w", err)
		}
		if err := g.add(ctx, q, user.ID, role); isUniqueViolation(err) {
			out.conflict = msgGrantDuplicate
			return errRollback
		} else if err != nil {
			return fmt.Errorf("add grant: %w", err)
		}
		if invited {
			t, err := auth.IssueAccountToken(ctx, q, user.ID, m.UserID, auth.PurposeInvite, auth.InviteTTL)
			if err != nil {
				return err
			}
			out.token = &t
		}
		if out.member, err = g.get(ctx, q, user.ID); err != nil {
			return fmt.Errorf("reload grant: %w", err)
		}
		after := g.snapshot(user.Email, role)
		after.Invited = invited
		if joined {
			if err := audit.Write(ctx, q, audit.Entry{
				OrganizationID: m.OrgID, Actor: m.UserID, Action: "member.add", ObjectType: "user", ObjectID: uuidStr(user.ID),
				After: memberSnapshot{Email: user.Email, Role: tenant.RoleMember, Permissions: []string{}, Invited: invited}, Meta: infoFrom(ctx).meta,
			}); err != nil {
				return err
			}
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "grant.add", ObjectType: "user", ObjectID: uuidStr(user.ID),
			After: after, Meta: infoFrom(ctx).meta,
		})
	})
	return out, err
}

func (s *Server) updateGrant(ctx context.Context, m tenant.Membership, g grantScope, user uuid.UUID, role string, version int32) (grantOutcome, error) {
	var out grantOutcome
	err := s.withTx(ctx, func(q store.Querier) error {
		before, err := g.get(ctx, q, pgUUID(user))
		if errors.Is(err, pgx.ErrNoRows) {
			out.notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load grant: %w", err)
		}
		if n, err := g.update(ctx, q, before.UserID, role, version); err != nil {
			return fmt.Errorf("update grant: %w", err)
		} else if n == 0 {
			out.conflict = msgGrantStale
			return errRollback
		}
		if out.member, err = g.get(ctx, q, before.UserID); err != nil {
			return fmt.Errorf("reload grant: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "grant.update", ObjectType: "user", ObjectID: uuidStr(before.UserID),
			Before: g.snapshot(before.Email, before.Role), After: g.snapshot(before.Email, role), Meta: infoFrom(ctx).meta,
		})
	})
	return out, err
}

func (s *Server) removeGrant(ctx context.Context, m tenant.Membership, g grantScope, user uuid.UUID) (grantOutcome, error) {
	var out grantOutcome
	err := s.withTx(ctx, func(q store.Querier) error {
		before, err := g.get(ctx, q, pgUUID(user))
		if errors.Is(err, pgx.ErrNoRows) {
			out.notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load grant: %w", err)
		}
		if _, err := g.remove(ctx, q, before.UserID); err != nil {
			return fmt.Errorf("remove grant: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "grant.remove", ObjectType: "user", ObjectID: uuidStr(before.UserID),
			Before: g.snapshot(before.Email, before.Role), Meta: infoFrom(ctx).meta,
		})
	})
	return out, err
}

// partnerGrantScope loads the partner and checks the caller may manage its grants: not visible → 404,
// visible but not admin → 403.
func (s *Server) partnerGrantScope(ctx context.Context, m tenant.Membership, id uuid.UUID) (grantScope, int, error) {
	p, err := s.q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(id), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !m.SeesPartner(p.ID)) {
		return grantScope{}, 404, nil
	}
	if err != nil {
		return grantScope{}, 0, fmt.Errorf("load partner: %w", err)
	}
	if m.PartnerLevel(p.ID) < tenant.LevelAdmin {
		return grantScope{}, 403, nil
	}
	return partnerScope(m, p.ID), 0, nil
}

func (s *Server) unitGrantScope(ctx context.Context, m tenant.Membership, id uuid.UUID) (grantScope, int, error) {
	u, err := s.q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(id), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.UnitLevel(u.ID, u.PartnerID) == tenant.LevelNone) {
		return grantScope{}, 404, nil
	}
	if err != nil {
		return grantScope{}, 0, fmt.Errorf("load business unit: %w", err)
	}
	if m.UnitLevel(u.ID, u.PartnerID) < tenant.LevelAdmin {
		return grantScope{}, 403, nil
	}
	return unitScope(m, u.ID), 0, nil
}

const msgGrantForbidden = "Chỉ admin của tổ chức, đối tác hoặc đơn vị được quản lý quyền ở đây"

func notFoundBody(msg string) apigen.NotFoundJSONResponse {
	return apigen.NotFoundJSONResponse{Message: msg}
}
func forbiddenBody() apigen.ForbiddenJSONResponse {
	return apigen.ForbiddenJSONResponse{Message: msgGrantForbidden}
}

func grantList(rows []store.GetPartnerMemberRow) apigen.GrantMemberList {
	out := apigen.GrantMemberList{Members: make([]apigen.GrantMember, 0, len(rows))}
	for _, r := range rows {
		out.Members = append(out.Members, toGrantMember(r))
	}
	return out
}

// --- partner grants ---

func (s *Server) ListPartnerMembers(ctx context.Context, req apigen.ListPartnerMembersRequestObject) (apigen.ListPartnerMembersResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.partnerGrantScope(ctx, m, req.PartnerId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.ListPartnerMembers404JSONResponse{NotFoundJSONResponse: notFoundBody(msgPartnerNotFound)}, nil
	case code == 403:
		return apigen.ListPartnerMembers403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	rows, err := s.q.ListPartnerMembers(ctx, store.ListPartnerMembersParams{OrganizationID: m.OrgID, PartnerID: g.id})
	if err != nil {
		return nil, fmt.Errorf("list partner members: %w", err)
	}
	conv := make([]store.GetPartnerMemberRow, len(rows))
	for i, r := range rows {
		conv[i] = store.GetPartnerMemberRow(r)
	}
	return apigen.ListPartnerMembers200JSONResponse(grantList(conv)), nil
}

func (s *Server) AddPartnerMember(ctx context.Context, req apigen.AddPartnerMemberRequestObject) (apigen.AddPartnerMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.partnerGrantScope(ctx, m, req.PartnerId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.AddPartnerMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgPartnerNotFound)}, nil
	case code == 403:
		return apigen.AddPartnerMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	if req.Body == nil || !req.Body.Role.Valid() {
		return apigen.AddPartnerMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Vai trò không hợp lệ"}}, nil
	}
	out, err := s.addGrant(ctx, m, g, string(req.Body.Email), string(req.Body.Role))
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.AddPartnerMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conflict != "":
		return apigen.AddPartnerMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	return apigen.AddPartnerMember201JSONResponse{Member: toGrantMember(out.member), InviteToken: out.token}, nil
}

func (s *Server) UpdatePartnerMember(ctx context.Context, req apigen.UpdatePartnerMemberRequestObject) (apigen.UpdatePartnerMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.partnerGrantScope(ctx, m, req.PartnerId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.UpdatePartnerMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgPartnerNotFound)}, nil
	case code == 403:
		return apigen.UpdatePartnerMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	if req.Body == nil || !req.Body.Role.Valid() {
		return apigen.UpdatePartnerMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Vai trò không hợp lệ"}}, nil
	}
	out, err := s.updateGrant(ctx, m, g, req.UserId, string(req.Body.Role), req.Body.Version)
	switch {
	case err != nil:
		return nil, err
	case out.notFound:
		return apigen.UpdatePartnerMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGrantNotFound)}, nil
	case out.conflict != "":
		return apigen.UpdatePartnerMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	return apigen.UpdatePartnerMember200JSONResponse(toGrantMember(out.member)), nil
}

func (s *Server) RemovePartnerMember(ctx context.Context, req apigen.RemovePartnerMemberRequestObject) (apigen.RemovePartnerMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.partnerGrantScope(ctx, m, req.PartnerId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.RemovePartnerMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgPartnerNotFound)}, nil
	case code == 403:
		return apigen.RemovePartnerMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	out, err := s.removeGrant(ctx, m, g, req.UserId)
	switch {
	case err != nil:
		return nil, err
	case out.notFound:
		return apigen.RemovePartnerMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGrantNotFound)}, nil
	}
	return apigen.RemovePartnerMember204Response{}, nil
}

// --- unit grants ---

func (s *Server) ListUnitMembers(ctx context.Context, req apigen.ListUnitMembersRequestObject) (apigen.ListUnitMembersResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.unitGrantScope(ctx, m, req.BusinessUnitId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.ListUnitMembers404JSONResponse{NotFoundJSONResponse: notFoundBody(msgUnitNotFound)}, nil
	case code == 403:
		return apigen.ListUnitMembers403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	rows, err := s.q.ListUnitMembers(ctx, store.ListUnitMembersParams{OrganizationID: m.OrgID, BusinessUnitID: g.id})
	if err != nil {
		return nil, fmt.Errorf("list unit members: %w", err)
	}
	conv := make([]store.GetPartnerMemberRow, len(rows))
	for i, r := range rows {
		conv[i] = store.GetPartnerMemberRow(r)
	}
	return apigen.ListUnitMembers200JSONResponse(grantList(conv)), nil
}

func (s *Server) AddUnitMember(ctx context.Context, req apigen.AddUnitMemberRequestObject) (apigen.AddUnitMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.unitGrantScope(ctx, m, req.BusinessUnitId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.AddUnitMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgUnitNotFound)}, nil
	case code == 403:
		return apigen.AddUnitMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	if req.Body == nil || !req.Body.Role.Valid() {
		return apigen.AddUnitMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Vai trò không hợp lệ"}}, nil
	}
	out, err := s.addGrant(ctx, m, g, string(req.Body.Email), string(req.Body.Role))
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.AddUnitMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conflict != "":
		return apigen.AddUnitMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	return apigen.AddUnitMember201JSONResponse{Member: toGrantMember(out.member), InviteToken: out.token}, nil
}

func (s *Server) UpdateUnitMember(ctx context.Context, req apigen.UpdateUnitMemberRequestObject) (apigen.UpdateUnitMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.unitGrantScope(ctx, m, req.BusinessUnitId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.UpdateUnitMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgUnitNotFound)}, nil
	case code == 403:
		return apigen.UpdateUnitMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	if req.Body == nil || !req.Body.Role.Valid() {
		return apigen.UpdateUnitMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Vai trò không hợp lệ"}}, nil
	}
	out, err := s.updateGrant(ctx, m, g, req.UserId, string(req.Body.Role), req.Body.Version)
	switch {
	case err != nil:
		return nil, err
	case out.notFound:
		return apigen.UpdateUnitMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGrantNotFound)}, nil
	case out.conflict != "":
		return apigen.UpdateUnitMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	return apigen.UpdateUnitMember200JSONResponse(toGrantMember(out.member)), nil
}

func (s *Server) RemoveUnitMember(ctx context.Context, req apigen.RemoveUnitMemberRequestObject) (apigen.RemoveUnitMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	g, code, err := s.unitGrantScope(ctx, m, req.BusinessUnitId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.RemoveUnitMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgUnitNotFound)}, nil
	case code == 403:
		return apigen.RemoveUnitMember403JSONResponse{ForbiddenJSONResponse: forbiddenBody()}, nil
	}
	out, err := s.removeGrant(ctx, m, g, req.UserId)
	switch {
	case err != nil:
		return nil, err
	case out.notFound:
		return apigen.RemoveUnitMember404JSONResponse{NotFoundJSONResponse: notFoundBody(msgGrantNotFound)}, nil
	}
	return apigen.RemoveUnitMember204Response{}, nil
}
