package tenant

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

func TestOrgIDFromPath(t *testing.T) {
	id := uuid.New()
	cases := []struct {
		path           string
		scoped, wantOK bool
	}{
		{"/api/healthz", false, false},
		{"/api/orgs", false, false}, // list endpoint is not tenant-scoped
		{"/api/orgs/" + id.String(), true, true},
		{"/api/orgs/" + id.String() + "/devices/x", true, true},
		{"/api/orgs/not-a-uuid", true, false},
		{"/api/orgs/" + uuidUpper(id), true, false}, // non-canonical form rejected
	}
	for _, c := range cases {
		got, scoped, ok := OrgIDFromPath(c.path)
		if scoped != c.scoped || ok != c.wantOK {
			t.Errorf("%s: scoped=%v ok=%v, want %v %v", c.path, scoped, ok, c.scoped, c.wantOK)
		}
		if ok && uuid.UUID(got.Bytes) != id {
			t.Errorf("%s: parsed %x", c.path, got.Bytes)
		}
	}
}

func uuidUpper(id uuid.UUID) string {
	s := []byte(id.String())
	for i, c := range s {
		if c >= 'a' && c <= 'f' {
			s[i] = c - 32
		}
	}
	return string(s)
}

type fakeLoader map[[2][16]byte]store.GetMembershipRow

func (f fakeLoader) GetMembership(_ context.Context, a store.GetMembershipParams) (store.GetMembershipRow, error) {
	row, ok := f[[2][16]byte{a.OrganizationID.Bytes, a.UserID.Bytes}]
	if !ok {
		return store.GetMembershipRow{}, pgx.ErrNoRows
	}
	return row, nil
}

func TestMiddleware(t *testing.T) {
	orgA, orgB, user := uuid.New(), uuid.New(), uuid.New()
	pg := func(u uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: u, Valid: true} }
	loader := fakeLoader{{orgA, user}: {OrganizationID: pg(orgA), UserID: pg(user), Role: RoleEditor}}

	var got Membership
	h := Middleware(loader, func(ctx context.Context) (pgtype.UUID, bool) {
		v, ok := ctx.Value("user").(pgtype.UUID)
		return v, ok
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = From(r.Context())
		w.WriteHeader(http.StatusTeapot)
	}))

	do := func(path string, signedIn bool) int {
		req := httptest.NewRequest("GET", path, nil)
		if signedIn {
			req = req.WithContext(context.WithValue(req.Context(), "user", pg(user))) //nolint:staticcheck // test-only key
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := do("/api/orgs/"+orgA.String()+"/x", true); code != http.StatusTeapot || got.Role != RoleEditor {
		t.Fatalf("member: code=%d role=%q", code, got.Role)
	}
	if code := do("/api/orgs/"+orgB.String(), true); code != http.StatusNotFound {
		t.Fatalf("non-member: code=%d, want 404", code)
	}
	if code := do("/api/orgs/garbage", true); code != http.StatusNotFound {
		t.Fatalf("bad id: code=%d, want 404", code)
	}
	if code := do("/api/orgs/"+orgA.String(), false); code != http.StatusUnauthorized {
		t.Fatalf("anonymous: code=%d, want 401", code)
	}
	if code := do("/api/healthz", false); code != http.StatusTeapot {
		t.Fatalf("unscoped path should pass through: %d", code)
	}
}

func TestRoles(t *testing.T) {
	for role, want := range map[string][2]bool{
		RoleOwner: {true, true}, RoleAdmin: {true, true}, RoleEditor: {true, false}, RoleViewer: {false, false},
	} {
		m := Membership{Role: role}
		if m.CanEdit() != want[0] || m.CanAdmin() != want[1] {
			t.Errorf("%s: CanEdit=%v CanAdmin=%v", role, m.CanEdit(), m.CanAdmin())
		}
	}
	if !(Membership{Permissions: []string{"user.manage"}}).Has("user.manage") {
		t.Error("Has")
	}
}

func TestRequireMatchesPathOrg(t *testing.T) {
	orgA := uuid.New()
	ctx := WithMembership(context.Background(), Membership{OrgID: pgtype.UUID{Bytes: orgA, Valid: true}})
	if _, err := Require(ctx, orgA); err != nil {
		t.Fatalf("same org: %v", err)
	}
	if _, err := Require(ctx, uuid.New()); err == nil {
		t.Fatal("different org accepted")
	}
	if _, err := Require(context.Background(), orgA); err == nil {
		t.Fatal("missing membership accepted")
	}
}
