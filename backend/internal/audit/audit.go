// Package audit writes the append-only audit trail (SRS §10, CLAUDE.md "Audit").
// Call Write inside the same transaction as the change it records, so the two commit or roll back together.
// Never put secrets in Before/After.
package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Meta is request context recorded with every entry.
type Meta struct {
	IP        netip.Addr
	UserAgent string
	RequestID string
}

// Entry is one audited action. OrganizationID is empty for system-level events (login, org creation).
type Entry struct {
	OrganizationID pgtype.UUID
	Actor          pgtype.UUID
	Action         string // e.g. organization.update
	ObjectType     string
	ObjectID       string
	Before         any // JSON-serialisable snapshot, or nil
	After          any
	Meta           Meta
}

// Write inserts the entry using q (pass the transaction's querier).
func Write(ctx context.Context, q store.Querier, e Entry) error {
	before, err := toJSON(e.Before)
	if err != nil {
		return fmt.Errorf("audit before: %w", err)
	}
	after, err := toJSON(e.After)
	if err != nil {
		return fmt.Errorf("audit after: %w", err)
	}
	params := store.InsertAuditLogParams{
		OrganizationID: e.OrganizationID,
		ActorUserID:    e.Actor,
		Action:         e.Action,
		ObjectType:     e.ObjectType,
		ObjectID:       e.ObjectID,
		Before:         before,
		After:          after,
		UserAgent:      e.Meta.UserAgent,
		RequestID:      e.Meta.RequestID,
	}
	if e.Meta.IP.IsValid() {
		ip := e.Meta.IP
		params.Ip = &ip
	}
	if err := q.InsertAuditLog(ctx, params); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func toJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}
