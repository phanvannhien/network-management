package api

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Access (ADR-032): every member sees the whole organization; write checks compare the organization level with
// what the action needs. Other organizations' data answers 404.

const (
	msgNoAccess     = "Bạn không có quyền với mục này"
	msgUnitMissing  = "Đơn vị không tồn tại trong tổ chức"
	msgOrgWideAdmin = "Chỉ owner/admin tổ chức được làm việc này"
)

func levelName(l int) apigen.AccessLevel {
	switch {
	case l >= tenant.LevelAdmin:
		return apigen.AccessLevelAdmin
	case l >= tenant.LevelEdit:
		return apigen.AccessLevelEdit
	}
	return apigen.AccessLevelView
}

// siteRef is what the level computation needs from a site.
type siteRef struct{ id, unit, partner pgtype.UUID }

// siteLevels is the caller's level on each site — the organization level (ADR-032).
func siteLevels(_ context.Context, _ store.Querier, m tenant.Membership, sites []siteRef) (map[pgtype.UUID]int, error) {
	out := make(map[pgtype.UUID]int, len(sites))
	for _, s := range sites {
		out[s.id] = m.Level()
	}
	return out, nil
}

func siteLevel(_ context.Context, _ store.Querier, m tenant.Membership, _ store.GetSiteRow) (int, error) {
	return m.Level(), nil
}
