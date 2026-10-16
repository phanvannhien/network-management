package tenant

import (
	"github.com/jackc/pgx/v5/pgtype"
)

// Partner / unit grants (ADR-029, ADR-031). Organization owners/admins/editors/viewers keep organization-wide
// access; RoleMember has none and sees only what its grants and shares give. Grants add up: a user sees the
// union of every partner and unit granted, and on a unit holds the higher of its unit role and partner role.

// RoleMember: belongs to the organization only through partner/unit grants.
const RoleMember = "member"

// Grant roles.
const (
	GrantPartnerAdmin = "partner_admin"
	GrantUnitAdmin    = "unit_admin"
	GrantEditor       = "editor"
	GrantViewer       = "viewer"
)

// Access levels, ordered.
const (
	LevelNone = iota
	LevelView
	LevelEdit
	LevelAdmin
)

func grantLevel(role string) int {
	switch role {
	case GrantPartnerAdmin, GrantUnitAdmin:
		return LevelAdmin
	case GrantEditor:
		return LevelEdit
	case GrantViewer:
		return LevelView
	}
	return LevelNone
}

// UnitGrant is a grant on one business unit.
type UnitGrant struct {
	Partner pgtype.UUID
	Role    string
}

// Grants are the caller's partner and unit grants in the organization (live partners/units only).
type Grants struct {
	Partners map[pgtype.UUID]string    // partner → role
	Units    map[pgtype.UUID]UnitGrant // unit → partner + role
}

// orgLevel is the access the organization role gives on every partner, unit and site.
func (m Membership) orgLevel() int {
	switch m.Role {
	case RoleOwner, RoleAdmin:
		return LevelAdmin
	case RoleEditor:
		return LevelEdit
	case RoleViewer:
		return LevelView
	}
	return LevelNone
}

// Restricted reports whether queries must be limited to the caller's grants and shares.
func (m Membership) Restricted() bool { return m.orgLevel() == LevelNone }

// PartnerLevel is the access on the partner itself (its details, its units, all sites of its units).
func (m Membership) PartnerLevel(partner pgtype.UUID) int {
	return max(m.orgLevel(), grantLevel(m.Grants.Partners[partner]))
}

// UnitLevel is the access on a unit of the given partner and on its sites.
func (m Membership) UnitLevel(unit, partner pgtype.UUID) int {
	l := m.PartnerLevel(partner)
	if g, ok := m.Grants.Units[unit]; ok {
		l = max(l, grantLevel(g.Role))
	}
	return l
}

// SeesPartner: the partner is granted, or one of its units is (the partner is then shown, read-only).
func (m Membership) SeesPartner(partner pgtype.UUID) bool {
	if m.PartnerLevel(partner) > LevelNone {
		return true
	}
	for _, g := range m.Grants.Units {
		if g.Partner == partner {
			return true
		}
	}
	return false
}

// ShareTargetLevel is the caller's level at the target of a share: on a partner target, any grant inside the
// partner counts (a share to a partner reaches all its units); on a unit target, the unit level.
func (m Membership) ShareTargetLevel(targetPartner, targetUnit, targetUnitPartner pgtype.UUID) int {
	if targetUnit.Valid {
		return m.UnitLevel(targetUnit, targetUnitPartner)
	}
	l := m.PartnerLevel(targetPartner)
	for _, g := range m.Grants.Units {
		if g.Partner == targetPartner {
			l = max(l, grantLevel(g.Role))
		}
	}
	return l
}

// GrantedPartnerIDs / GrantedUnitIDs feed the SQL visibility filter; SharePartnerIDs are the partners whose
// shares reach the caller (granted partners plus partners of granted units).
func (m Membership) GrantedPartnerIDs() []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(m.Grants.Partners))
	for id := range m.Grants.Partners {
		out = append(out, id)
	}
	return out
}

func (m Membership) GrantedUnitIDs() []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(m.Grants.Units))
	for id := range m.Grants.Units {
		out = append(out, id)
	}
	return out
}

func (m Membership) SharePartnerIDs() []pgtype.UUID {
	seen := map[pgtype.UUID]bool{}
	out := []pgtype.UUID{}
	for id := range m.Grants.Partners {
		seen[id] = true
		out = append(out, id)
	}
	for _, g := range m.Grants.Units {
		if !seen[g.Partner] {
			seen[g.Partner] = true
			out = append(out, g.Partner)
		}
	}
	return out
}
