// Package tenant resolves the organization of a request from its path and enforces membership
// (ADR-016, ADR-023). Every business endpoint lives under /api/orgs/{orgId}/…; handlers read the
// organization only from the context set here — never from the request body.
package tenant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// OrgPathPrefix marks tenant-scoped routes.
const OrgPathPrefix = "/api/orgs/"

// Roles (memberships.role).
const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleEditor = "editor"
	RoleViewer = "viewer"
)

// Membership is the caller's access to the organization named in the URL.
type Membership struct {
	OrgID       pgtype.UUID
	UserID      pgtype.UUID
	Role        string
	Permissions []string
	SiteScope   []pgtype.UUID // nil = all sites
	OrgName     string
	OrgKind     string
}

// CanEdit: owner, admin, editor may change business data.
func (m Membership) CanEdit() bool {
	return m.Role == RoleOwner || m.Role == RoleAdmin || m.Role == RoleEditor
}

// CanAdmin: owner and admin manage the organization itself (settings, users).
func (m Membership) CanAdmin() bool { return m.Role == RoleOwner || m.Role == RoleAdmin }

// SiteFilter is the site restriction to apply to queries (ADR-025): nil = every site. Owner/admin are never
// restricted; for editors/viewers a non-nil scope (even empty) limits them to exactly those sites.
func (m Membership) SiteFilter() []pgtype.UUID {
	if m.CanAdmin() || m.SiteScope == nil {
		return nil
	}
	return m.SiteScope
}

// Scoped reports whether the member is limited to some sites (and so may not create new ones).
func (m Membership) Scoped() bool { return m.SiteFilter() != nil }

// SiteAllowed reports whether the member may see the site.
func (m Membership) SiteAllowed(site pgtype.UUID) bool {
	f := m.SiteFilter()
	return f == nil || slices.Contains(f, site)
}

// Has reports an extra permission (credential.reveal, credential.manage, user.manage).
func (m Membership) Has(permission string) bool { return slices.Contains(m.Permissions, permission) }

type ctxKey struct{}

// From returns the membership placed in ctx by the middleware.
func From(ctx context.Context) (Membership, bool) {
	m, ok := ctx.Value(ctxKey{}).(Membership)
	return m, ok
}

// WithMembership stores m in ctx (middleware and tests).
func WithMembership(ctx context.Context, m Membership) context.Context {
	return context.WithValue(ctx, ctxKey{}, m)
}

// MembershipLoader is the slice of store.Querier the middleware needs.
type MembershipLoader interface {
	GetMembership(ctx context.Context, arg store.GetMembershipParams) (store.GetMembershipRow, error)
}

// UserFunc returns the signed-in user for a request (false = not signed in).
type UserFunc func(ctx context.Context) (pgtype.UUID, bool)

// Middleware enforces membership for every /api/orgs/{orgId}… request. Unknown, deleted or
// not-a-member organizations all answer 404 so the existence of other tenants is never revealed.
func Middleware(q MembershipLoader, user UserFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			orgID, scoped, ok := OrgIDFromPath(r.URL.Path)
			if !scoped {
				next.ServeHTTP(w, r)
				return
			}
			userID, signedIn := user(r.Context())
			if !signedIn {
				writeError(w, http.StatusUnauthorized, "Chưa đăng nhập")
				return
			}
			if !ok {
				writeError(w, http.StatusNotFound, "Không tìm thấy tổ chức")
				return
			}
			row, err := q.GetMembership(r.Context(), store.GetMembershipParams{OrganizationID: orgID, UserID: userID})
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, "Không tìm thấy tổ chức")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Lỗi máy chủ")
				return
			}
			m := Membership{
				OrgID: row.OrganizationID, UserID: row.UserID, Role: row.Role, Permissions: row.Permissions,
				SiteScope: row.SiteScope, OrgName: row.OrganizationName, OrgKind: row.OrganizationKind,
			}
			next.ServeHTTP(w, r.WithContext(WithMembership(r.Context(), m)))
		})
	}
}

// OrgIDFromPath parses /api/orgs/{orgId}[/…]. scoped reports whether the path is tenant-scoped;
// ok is false when the id segment is not a valid UUID.
func OrgIDFromPath(path string) (id pgtype.UUID, scoped bool, ok bool) {
	rest, found := strings.CutPrefix(path, OrgPathPrefix)
	if !found {
		return pgtype.UUID{}, false, false
	}
	segment, _, _ := strings.Cut(rest, "/")
	parsed, err := uuid.Parse(segment)
	if err != nil || segment != parsed.String() { // canonical lowercase form only
		return pgtype.UUID{}, true, false
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, true, true
}

// Require returns the membership for the organization a handler was asked about. The generated
// handler gets orgId as a path parameter; it must match what the middleware verified.
func Require(ctx context.Context, orgID uuid.UUID) (Membership, error) {
	m, ok := From(ctx)
	if !ok || uuid.UUID(m.OrgID.Bytes) != orgID {
		return Membership{}, fmt.Errorf("tenant: organization %s not resolved by middleware", orgID)
	}
	return m, nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}
