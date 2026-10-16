package api

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Access on partners, units and sites (P1-07c, ADR-029/031). Visibility is enforced in SQL (sites) or by
// filtering (partners, units); write checks compare the caller's level with what the action needs.
// Anything the caller cannot see answers 404, like another organization's data.

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

// siteVisibility is the SQL filter for the caller (restricted = role member).
type siteVisibility struct {
	restricted                          bool
	grantUnits, grantPartners, sharePts []pgtype.UUID
}

func visibilityOf(m tenant.Membership) siteVisibility {
	return siteVisibility{m.Restricted(), m.GrantedUnitIDs(), m.GrantedPartnerIDs(), m.SharePartnerIDs()}
}

// siteRef is what the level computation needs from a site.
type siteRef struct{ id, unit, partner pgtype.UUID }

// siteLevels computes the caller's level on each site: the level on its owning unit (organization role,
// partner grant or unit grant), raised by shares that reach the caller — a share gives view, or edit when it
// is editable and the caller can edit at the share's target. Shares never give admin (delete, re-share).
func siteLevels(ctx context.Context, q store.Querier, m tenant.Membership, sites []siteRef) (map[pgtype.UUID]int, error) {
	out := make(map[pgtype.UUID]int, len(sites))
	var pending []pgtype.UUID
	for _, s := range sites {
		l := m.UnitLevel(s.unit, s.partner)
		out[s.id] = l
		// Shares only matter below edit, and only for callers holding grants.
		if l < tenant.LevelEdit && (len(m.Grants.Partners) > 0 || len(m.Grants.Units) > 0) {
			pending = append(pending, s.id)
		}
	}
	if len(pending) == 0 {
		return out, nil
	}
	shares, err := q.ListSharesForSites(ctx, store.ListSharesForSitesParams{OrganizationID: m.OrgID, SiteIds: pending})
	if err != nil {
		return nil, fmt.Errorf("list site shares: %w", err)
	}
	for _, sh := range shares {
		target := m.ShareTargetLevel(sh.TargetPartnerID, sh.TargetUnitID, sh.TargetUnitPartnerID)
		l := tenant.LevelNone
		switch {
		case target >= tenant.LevelEdit && sh.Access == "edit":
			l = tenant.LevelEdit
		case target >= tenant.LevelView:
			l = tenant.LevelView
		}
		out[sh.SiteID] = max(out[sh.SiteID], l)
	}
	return out, nil
}

func siteLevel(ctx context.Context, q store.Querier, m tenant.Membership, s store.GetSiteRow) (int, error) {
	levels, err := siteLevels(ctx, q, m, []siteRef{{s.ID, s.BusinessUnitID, s.PartnerID}})
	if err != nil {
		return 0, err
	}
	return levels[s.ID], nil
}
