package api

import (
	"context"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Access (ADR-032): every member sees the whole organization; write checks compare the organization level with
// what the action needs. Other organizations' data answers 404.

const (
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

func siteLevel(_ context.Context, _ store.Querier, m tenant.Membership, _ store.GetSiteRow) (int, error) {
	return m.Level(), nil
}
