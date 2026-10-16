package tenant

import (
	"github.com/jackc/pgx/v5/pgtype"
)

// Access (ADR-032): the organization role decides everything — every member sees the whole organization; editors
// change data, owners/admins also manage users and delete. There are no per-branch grants or record shares.

// Access levels, ordered.
const (
	LevelNone = iota
	LevelView
	LevelEdit
	LevelAdmin
)

// Level is the access the organization role gives on every record of the organization.
func (m Membership) Level() int {
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

// UnitLevel / PartnerLevel are the organization level; kept until business units leave the data model (P1-29).
func (m Membership) UnitLevel(_, _ pgtype.UUID) int { return m.Level() }
func (m Membership) PartnerLevel(_ pgtype.UUID) int { return m.Level() }
