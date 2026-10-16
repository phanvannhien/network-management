package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

const msgLinkInvalid = "Link không hợp lệ, đã dùng hoặc đã hết hạn"

// InspectAccountToken shows what a one-time link is for (public; the token itself is the credential).
func (s *Server) InspectAccountToken(ctx context.Context, req apigen.InspectAccountTokenRequestObject) (apigen.InspectAccountTokenResponseObject, error) {
	info, err := s.auth.InspectAccountToken(ctx, req.Token)
	if errors.Is(err, auth.ErrTokenInvalid) {
		return apigen.InspectAccountToken404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgLinkInvalid}}, nil
	}
	if err != nil {
		return nil, err
	}
	orgs := info.Organizations
	if orgs == nil {
		orgs = []string{}
	}
	return apigen.InspectAccountToken200JSONResponse{
		Email: info.Email, Purpose: apigen.AccountTokenInfoPurpose(info.Purpose), Organizations: orgs,
	}, nil
}

// AcceptAccountToken sets the password using a one-time link.
func (s *Server) AcceptAccountToken(ctx context.Context, req apigen.AcceptAccountTokenRequestObject) (apigen.AcceptAccountTokenResponseObject, error) {
	if req.Body == nil {
		return apigen.AcceptAccountToken400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	name := ""
	if req.Body.DisplayName != nil {
		name = *req.Body.DisplayName
	}
	err := s.auth.AcceptAccountToken(ctx, req.Token, name, req.Body.Password, infoFrom(ctx).meta)
	switch {
	case errors.Is(err, auth.ErrWeakPassword):
		return apigen.AcceptAccountToken400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{
			Message: fmt.Sprintf("Mật khẩu tối thiểu %d ký tự", auth.MinPasswordLength),
		}}, nil
	case errors.Is(err, auth.ErrTokenInvalid):
		return apigen.AcceptAccountToken404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: msgLinkInvalid}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.AcceptAccountToken204Response{}, nil
}

// --- System admin: users (route gated by requireSystemAdmin) ---

// AdminListUsers lists every user.
func (s *Server) AdminListUsers(ctx context.Context, _ apigen.AdminListUsersRequestObject) (apigen.AdminListUsersResponseObject, error) {
	rows, err := s.q.AdminListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin list users: %w", err)
	}
	out := apigen.AdminUserList{Users: make([]apigen.AdminUser, 0, len(rows))}
	for _, r := range rows {
		out.Users = append(out.Users, apigen.AdminUser{
			Id: uuid.UUID(r.ID.Bytes), Email: r.Email, DisplayName: r.DisplayName, IsSystemAdmin: r.IsSystemAdmin,
			MfaEnabled: r.MfaEnabled, Disabled: r.Disabled, PendingInvite: r.PendingInvite,
			OrganizationCount: r.OrganizationCount, CreatedAt: r.CreatedAt.Time,
		})
	}
	return apigen.AdminListUsers200JSONResponse(out), nil
}

// AdminDisableUser soft-deletes a user and ends all their sessions (ADR-022).
func (s *Server) AdminDisableUser(ctx context.Context, req apigen.AdminDisableUserRequestObject) (apigen.AdminDisableUserResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	target := pgUUID(req.UserId)
	if target == sess.UserID {
		return apigen.AdminDisableUser409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Không thể tự vô hiệu hóa tài khoản của mình"}}, nil
	}
	var notFound bool
	var conflict string
	err := s.withTx(ctx, func(q store.Querier) error {
		user, err := q.GetUserByID(ctx, target)
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load user: %w", err)
		}
		if user.IsSystemAdmin && !user.DisabledAt.Valid {
			if n, err := q.CountActiveSystemAdmins(ctx); err != nil {
				return fmt.Errorf("count admins: %w", err)
			} else if n <= 1 {
				conflict = "Phải còn ít nhất một system admin đang hoạt động"
				return errRollback
			}
		}
		if _, err := q.SetUserDisabled(ctx, store.SetUserDisabledParams{ID: target, Disabled: true}); err != nil {
			return fmt.Errorf("disable user: %w", err)
		}
		if err := q.DeleteUserSessions(ctx, target); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			Actor: sess.UserID, Action: "user.disable", ObjectType: "user", ObjectID: user.Email,
			Before: userState{Disabled: false}, After: userState{Disabled: true}, Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.AdminDisableUser404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy người dùng"}}, nil
	case conflict != "":
		return apigen.AdminDisableUser409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.AdminDisableUser204Response{}, nil
}

// AdminEnableUser re-enables a disabled user.
func (s *Server) AdminEnableUser(ctx context.Context, req apigen.AdminEnableUserRequestObject) (apigen.AdminEnableUserResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	var notFound bool
	err := s.withTx(ctx, func(q store.Querier) error {
		user, err := q.SetUserDisabled(ctx, store.SetUserDisabledParams{ID: pgUUID(req.UserId), Disabled: false})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("enable user: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			Actor: sess.UserID, Action: "user.enable", ObjectType: "user", ObjectID: user.Email,
			Before: userState{Disabled: true}, After: userState{Disabled: false}, Meta: infoFrom(ctx).meta,
		})
	})
	if notFound {
		return apigen.AdminEnableUser404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy người dùng"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.AdminEnableUser204Response{}, nil
}

// AdminResetMfa removes TOTP and recovery codes and signs the user out; they enroll again at next sign-in.
func (s *Server) AdminResetMfa(ctx context.Context, req apigen.AdminResetMfaRequestObject) (apigen.AdminResetMfaResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	target := pgUUID(req.UserId)
	var notFound bool
	err := s.withTx(ctx, func(q store.Querier) error {
		user, err := q.GetUserByID(ctx, target)
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load user: %w", err)
		}
		if err := q.ResetUserMFA(ctx, target); err != nil {
			return fmt.Errorf("reset mfa: %w", err)
		}
		if err := q.DeleteRecoveryCodes(ctx, target); err != nil {
			return fmt.Errorf("delete recovery codes: %w", err)
		}
		if err := q.DeleteUserSessions(ctx, target); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			Actor: sess.UserID, Action: "user.mfa_reset", ObjectType: "user", ObjectID: user.Email,
			Before: mfaState{MFAEnabled: true}, After: mfaState{MFAEnabled: false}, Meta: infoFrom(ctx).meta,
		})
	})
	if notFound {
		return apigen.AdminResetMfa404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy người dùng"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.AdminResetMfa204Response{}, nil
}

// AdminCreatePasswordReset issues a one-time reset link (system admin only: an org admin resetting a user
// who also belongs to other organizations could take over that access).
func (s *Server) AdminCreatePasswordReset(ctx context.Context, req apigen.AdminCreatePasswordResetRequestObject) (apigen.AdminCreatePasswordResetResponseObject, error) {
	sess, _ := sessionFrom(ctx)
	target := pgUUID(req.UserId)
	var (
		token    string
		notFound bool
	)
	err := s.withTx(ctx, func(q store.Querier) error {
		user, err := q.GetUserByID(ctx, target)
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load user: %w", err)
		}
		if token, err = auth.IssueAccountToken(ctx, q, target, sess.UserID, auth.PurposePasswordReset, auth.PasswordResetTTL); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{Actor: sess.UserID, Action: "user.password_reset_issued", ObjectType: "user", ObjectID: user.Email, Meta: infoFrom(ctx).meta})
	})
	if notFound {
		return apigen.AdminCreatePasswordReset404JSONResponse{NotFoundJSONResponse: apigen.NotFoundJSONResponse{Message: "Không tìm thấy người dùng"}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.AdminCreatePasswordReset200JSONResponse{ResetToken: token}, nil
}

// Audit snapshots for system user administration (no secrets).
type userState struct {
	Disabled bool `json:"disabled"`
}

type mfaState struct {
	MFAEnabled bool `json:"mfaEnabled"`
}
