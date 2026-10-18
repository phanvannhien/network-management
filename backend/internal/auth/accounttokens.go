package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Token purposes (user_tokens.purpose).
const (
	PurposeInvite        = "invite"
	PurposePasswordReset = "password_reset"
)

// Lifetimes of one-time account links.
const (
	InviteTTL        = 7 * 24 * time.Hour
	PasswordResetTTL = 24 * time.Hour
	maxDisplayName   = 100
)

var (
	// ErrTokenInvalid covers unknown, used, expired and disabled-user tokens alike.
	ErrTokenInvalid = errors.New("account link invalid or expired")
	// ErrWeakPassword is returned when the password is shorter than MinPasswordLength.
	ErrWeakPassword = errors.New("password too short")
)

// IssueAccountToken creates a one-time link token (newest one wins: older links of the same purpose are
// retired). Call inside the caller's transaction; the raw token is returned once and never stored.
func IssueAccountToken(ctx context.Context, q store.Querier, userID, createdBy pgtype.UUID, purpose string, ttl time.Duration) (string, error) {
	token, err := NewToken()
	if err != nil {
		return "", err
	}
	if err := q.InvalidateUserTokens(ctx, store.InvalidateUserTokensParams{UserID: userID, Purpose: purpose}); err != nil {
		return "", fmt.Errorf("retire old tokens: %w", err)
	}
	if err := q.CreateUserToken(ctx, store.CreateUserTokenParams{
		TokenHash: HashToken(token), UserID: userID, Purpose: purpose, CreatedBy: createdBy,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(ttl), Valid: true},
	}); err != nil {
		return "", fmt.Errorf("store token: %w", err)
	}
	return token, nil
}

// AccountTokenInfo is shown on the accept page before the user sets a password.
type AccountTokenInfo struct {
	Email         string
	Purpose       string
	Organizations []string
}

// InspectAccountToken returns what a valid link is for.
func (s *Service) InspectAccountToken(ctx context.Context, token string) (AccountTokenInfo, error) {
	row, err := s.q.GetUserToken(ctx, HashToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return AccountTokenInfo{}, ErrTokenInvalid
	}
	if err != nil {
		return AccountTokenInfo{}, fmt.Errorf("load token: %w", err)
	}
	orgs, err := s.q.ListUserOrganizationNames(ctx, row.UserID)
	if err != nil {
		return AccountTokenInfo{}, fmt.Errorf("list organizations: %w", err)
	}
	return AccountTokenInfo{Email: row.Email, Purpose: row.Purpose, Organizations: orgs}, nil
}

// AcceptAccountToken sets the password (and display name for invitations), consumes the link and
// signs the user out everywhere — one transaction.
func (s *Service) AcceptAccountToken(ctx context.Context, token, displayName, password string, meta RequestMeta) error {
	// Unauthenticated: bounded per IP, and the (cheap) token lookup comes before the (costly) password hash.
	if !s.ipLimit.Allow("token-ip:" + meta.IP.String()) {
		return ErrRateLimited
	}
	if len(password) < MinPasswordLength {
		return ErrWeakPassword
	}
	if len(password) > MaxPasswordLength {
		return ErrWeakPassword
	}
	if _, err := s.q.GetUserToken(ctx, HashToken(token)); errors.Is(err, pgx.ErrNoRows) {
		return ErrTokenInvalid
	} else if err != nil {
		return fmt.Errorf("load token: %w", err)
	}
	displayName = strings.TrimSpace(displayName)
	if utf8.RuneCountInString(displayName) > maxDisplayName {
		displayName = string([]rune(displayName)[:maxDisplayName])
	}
	hash, err := HashPassword(password, s.argon)
	if err != nil {
		return err
	}
	return s.withTx(ctx, func(q store.Querier) error {
		row, err := q.GetUserToken(ctx, HashToken(token))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenInvalid
		}
		if err != nil {
			return fmt.Errorf("load token: %w", err)
		}
		if n, err := q.UseUserToken(ctx, row.TokenHash); err != nil {
			return fmt.Errorf("use token: %w", err)
		} else if n != 1 {
			return ErrTokenInvalid // consumed concurrently
		}
		if err := q.InvalidateUserTokens(ctx, store.InvalidateUserTokensParams{UserID: row.UserID, Purpose: row.Purpose}); err != nil {
			return fmt.Errorf("retire other tokens: %w", err)
		}
		if row.Purpose != PurposeInvite {
			displayName = "" // a reset keeps the existing name
		}
		if err := q.SetUserPassword(ctx, store.SetUserPasswordParams{ID: row.UserID, PasswordHash: hash, DisplayName: displayName}); err != nil {
			return fmt.Errorf("set password: %w", err)
		}
		if err := q.DeleteUserSessions(ctx, row.UserID); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		action := "account.invite_accepted"
		if row.Purpose == PurposePasswordReset {
			action = "account.password_reset"
		}
		return audit.Write(ctx, q, audit.Entry{Actor: row.UserID, Action: action, ObjectType: "user", ObjectID: row.Email, Meta: meta})
	})
}
