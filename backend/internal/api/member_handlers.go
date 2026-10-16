package api

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"slices"
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

const permUserManage = "user.manage"

// memberSnapshot is what audit before/after records for a membership.
type memberSnapshot struct {
	Email       string   `json:"email"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
	Invited     bool     `json:"invited,omitempty"`
}

// canManageMembers: owner, admin, or anyone granted user.manage (ADR-019).
func canManageMembers(m tenant.Membership) bool { return m.CanAdmin() || m.Has(permUserManage) }

// checkRoleChange decides whether actor may move a member from role `from` ("" = not a member yet) to
// role `to` ("" = remove) and set the given permissions. Returns a user-facing reason, or "" if allowed.
//   - managing members needs owner/admin/user.manage;
//   - only owners grant, change or remove the owner role;
//   - only owners/admins grant, change or remove the admin role, and grant extra permissions.
func checkRoleChange(actor tenant.Membership, from, to string, permsChanged bool) string {
	if !canManageMembers(actor) {
		return "Bạn không có quyền quản lý thành viên"
	}
	if (from == tenant.RoleOwner || to == tenant.RoleOwner) && actor.Role != tenant.RoleOwner {
		return "Chỉ owner được cấp, đổi hoặc gỡ vai trò owner"
	}
	if (from == tenant.RoleAdmin || to == tenant.RoleAdmin || permsChanged) && !actor.CanAdmin() {
		return "Chỉ owner/admin được cấp vai trò admin hoặc quyền bổ sung"
	}
	return ""
}

var validRoles = []string{tenant.RoleOwner, tenant.RoleAdmin, tenant.RoleEditor, tenant.RoleViewer, tenant.RoleMember}

// normalizePermissions validates against the enum and removes duplicates (stable order).
func normalizePermissions(in *[]apigen.Permission) ([]string, bool) {
	out := []string{}
	if in == nil {
		return out, true
	}
	for _, p := range *in {
		if !p.Valid() {
			return nil, false
		}
		if !slices.Contains(out, string(p)) {
			out = append(out, string(p))
		}
	}
	slices.Sort(out)
	return out, true
}

func toMember(r store.GetMemberRow) apigen.Member {
	perms := make([]apigen.Permission, 0, len(r.Permissions))
	for _, p := range r.Permissions {
		perms = append(perms, apigen.Permission(p))
	}
	return apigen.Member{
		UserId: uuid.UUID(r.UserID.Bytes), Email: r.Email, DisplayName: r.DisplayName, Role: apigen.Role(r.Role),
		Permissions: perms, MfaEnabled: r.MfaEnabled, Disabled: r.Disabled, PendingInvite: r.PendingInvite, Version: r.Version,
	}
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func sameStrings(a, b []string) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}

// ListMembers: members with an organization role see who belongs to the organization; grant-only members
// (role member, ADR-031) do not — they would see the users of other partners.
func (s *Server) ListMembers(ctx context.Context, req apigen.ListMembersRequestObject) (apigen.ListMembersResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if m.Restricted() {
		return apigen.ListMembers403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgNoAccess}}, nil
	}
	rows, err := s.q.ListMembers(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	out := apigen.MemberList{Members: make([]apigen.Member, 0, len(rows))}
	for _, r := range rows {
		out.Members = append(out.Members, toMember(store.GetMemberRow(r)))
	}
	return apigen.ListMembers200JSONResponse(out), nil
}

// AddMember adds an existing user, or creates an invited user with a one-time link.
func (s *Server) AddMember(ctx context.Context, req apigen.AddMemberRequestObject) (apigen.AddMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	bad := func(msg string) (apigen.AddMemberResponseObject, error) {
		return apigen.AddMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	if req.Body == nil {
		return bad("Thiếu dữ liệu")
	}
	email := strings.TrimSpace(string(req.Body.Email))
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email || len(email) > 320 {
		return bad("Email không hợp lệ")
	}
	role := string(req.Body.Role)
	if !slices.Contains(validRoles, role) {
		return bad("Vai trò không hợp lệ")
	}
	perms, ok := normalizePermissions(req.Body.Permissions)
	if !ok {
		return bad("Quyền bổ sung không hợp lệ")
	}
	if msg := checkRoleChange(m, "", role, len(perms) > 0); msg != "" {
		return apigen.AddMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msg}}, nil
	}

	var (
		member   store.GetMemberRow
		token    *string
		conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
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
		default:
			if _, err := q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: user.ID}); err == nil {
				conflict = "Người này đã là thành viên của tổ chức"
				return errRollback
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("check membership: %w", err)
			}
			if user.PasswordHash == "" {
				// Pending invite owned by another organization: whoever holds that link would gain access
				// here too, so refuse until the person activates their account.
				conflict = "Email này đang chờ kích hoạt từ một lời mời khác. Hãy thêm lại sau khi người đó kích hoạt tài khoản."
				return errRollback
			}
		}
		if _, err := q.AddMembershipWithPermissions(ctx, store.AddMembershipWithPermissionsParams{
			OrganizationID: m.OrgID, UserID: user.ID, Role: role, Permissions: perms,
		}); err != nil {
			return fmt.Errorf("add membership: %w", err)
		}
		if invited {
			t, err := auth.IssueAccountToken(ctx, q, user.ID, m.UserID, auth.PurposeInvite, auth.InviteTTL)
			if err != nil {
				return err
			}
			token = &t
		}
		if member, err = q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: user.ID}); err != nil {
			return fmt.Errorf("reload member: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "member.add", ObjectType: "user", ObjectID: uuidStr(user.ID),
			After: memberSnapshot{Email: user.Email, Role: role, Permissions: perms, Invited: invited}, Meta: infoFrom(ctx).meta,
		})
	})
	if conflict != "" {
		return apigen.AddMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.AddMember201JSONResponse{Member: toMember(member), InviteToken: token}, nil
}

// UpdateMember changes role / permissions with role rules, the last-owner guard and an optimistic lock.
func (s *Server) UpdateMember(ctx context.Context, req apigen.UpdateMemberRequestObject) (apigen.UpdateMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || !slices.Contains(validRoles, string(req.Body.Role)) {
		return apigen.UpdateMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Vai trò không hợp lệ"}}, nil
	}
	perms, ok := normalizePermissions(&req.Body.Permissions)
	if !ok {
		return apigen.UpdateMember400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Quyền bổ sung không hợp lệ"}}, nil
	}
	role := string(req.Body.Role)

	var (
		updated             store.GetMemberRow
		notFound            bool
		forbidden, conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: pgUUID(req.UserId)})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		if forbidden = checkRoleChange(m, before.Role, role, !sameStrings(before.Permissions, perms)); forbidden != "" {
			return errRollback
		}
		if before.Role == tenant.RoleOwner && role != tenant.RoleOwner {
			if n, err := q.CountOwners(ctx, m.OrgID); err != nil {
				return fmt.Errorf("count owners: %w", err)
			} else if n <= 1 {
				conflict = "Tổ chức phải còn ít nhất một owner"
				return errRollback
			}
		}
		if _, err := q.UpdateMembership(ctx, store.UpdateMembershipParams{
			OrganizationID: m.OrgID, UserID: before.UserID, Role: role, Permissions: perms, Version: req.Body.Version,
		}); errors.Is(err, pgx.ErrNoRows) {
			conflict = "Thành viên vừa được người khác sửa. Tải lại rồi thử lại."
			return errRollback
		} else if err != nil {
			return fmt.Errorf("update membership: %w", err)
		}
		if updated, err = q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: before.UserID}); err != nil {
			return fmt.Errorf("reload member: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "member.update", ObjectType: "user", ObjectID: uuidStr(before.UserID),
			Before: memberSnapshot{Email: before.Email, Role: before.Role, Permissions: before.Permissions},
			After:  memberSnapshot{Email: before.Email, Role: role, Permissions: perms},
			Meta:   infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateMember404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy thành viên"}}, nil
	case forbidden != "":
		return apigen.UpdateMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: forbidden}}, nil
	case conflict != "":
		return apigen.UpdateMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateMember200JSONResponse(toMember(updated)), nil
}

// RemoveMember removes a membership. Anyone may leave; removing others follows the role rules.
func (s *Server) RemoveMember(ctx context.Context, req apigen.RemoveMemberRequestObject) (apigen.RemoveMemberResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	target := pgUUID(req.UserId)
	self := target == m.UserID
	var (
		notFound            bool
		forbidden, conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: target})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		if !self {
			if forbidden = checkRoleChange(m, before.Role, "", false); forbidden != "" {
				return errRollback
			}
		}
		if before.Role == tenant.RoleOwner {
			if n, err := q.CountOwners(ctx, m.OrgID); err != nil {
				return fmt.Errorf("count owners: %w", err)
			} else if n <= 1 {
				conflict = "Không thể gỡ owner cuối cùng của tổ chức"
				return errRollback
			}
		}
		if _, err := q.DeleteMembership(ctx, store.DeleteMembershipParams{OrganizationID: m.OrgID, UserID: target}); err != nil {
			return fmt.Errorf("delete membership: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "member.remove", ObjectType: "user", ObjectID: uuidStr(target),
			Before: memberSnapshot{Email: before.Email, Role: before.Role, Permissions: before.Permissions},
			Meta:   infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.RemoveMember404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy thành viên"}}, nil
	case forbidden != "":
		return apigen.RemoveMember403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: forbidden}}, nil
	case conflict != "":
		return apigen.RemoveMember409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.RemoveMember204Response{}, nil
}

// RegenerateInvite issues a fresh link for a member who has not activated yet (only if this is their only org).
func (s *Server) RegenerateInvite(ctx context.Context, req apigen.RegenerateInviteRequestObject) (apigen.RegenerateInviteResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !canManageMembers(m) {
		return apigen.RegenerateInvite403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Bạn không có quyền quản lý thành viên"}}, nil
	}
	var (
		token    string
		notFound bool
		conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		member, err := q.GetMember(ctx, store.GetMemberParams{OrganizationID: m.OrgID, UserID: pgUUID(req.UserId)})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load member: %w", err)
		}
		if !member.PendingInvite {
			conflict = "Người này đã kích hoạt tài khoản"
			return errRollback
		}
		if n, err := q.CountUserMemberships(ctx, member.UserID); err != nil {
			return fmt.Errorf("count memberships: %w", err)
		} else if n != 1 {
			conflict = "Không thể cấp lại link cho tài khoản đang thuộc tổ chức khác"
			return errRollback
		}
		if token, err = auth.IssueAccountToken(ctx, q, member.UserID, m.UserID, auth.PurposeInvite, auth.InviteTTL); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "member.invite_regenerated", ObjectType: "user",
			ObjectID: uuidStr(member.UserID), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.RegenerateInvite404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy thành viên"}}, nil
	case conflict != "":
		return apigen.RegenerateInvite409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.RegenerateInvite200JSONResponse{InviteToken: token}, nil
}
