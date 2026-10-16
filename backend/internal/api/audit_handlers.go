package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

const (
	auditDefaultPageSize = 50
	auditMaxPageSize     = 200
	auditMaxQuery        = 200
)

var auditCategoryRe = regexp.MustCompile(`^[a-z_]{1,40}$`)

// auditFilter is the validated query shared by the organization and system audit lists.
type auditFilter struct {
	page, pageSize int32
	q              string // LIKE wildcards already escaped
	categories     []string
	actor          pgtype.UUID
	from, to       pgtype.Timestamptz
}

func (f auditFilter) offset() int32 { return (f.page - 1) * f.pageSize }

// escapeLike makes user text literal inside ILIKE '%…%' (the default escape character is backslash).
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// parseAuditFilter validates the query string; a non-empty message means 400.
func parseAuditFilter(page, pageSize *int32, q *string, categories *[]string, actor *uuid.UUID, from, to *time.Time) (auditFilter, string) {
	f := auditFilter{page: 1, pageSize: auditDefaultPageSize, categories: []string{}}
	if page != nil {
		if *page < 1 {
			return f, "page phải ≥ 1"
		}
		f.page = *page
	}
	if pageSize != nil {
		if *pageSize < 1 || *pageSize > auditMaxPageSize {
			return f, fmt.Sprintf("pageSize phải từ 1 đến %d", auditMaxPageSize)
		}
		f.pageSize = *pageSize
	}
	if q != nil {
		text := strings.TrimSpace(*q)
		if len([]rune(text)) > auditMaxQuery {
			return f, "Chuỗi tìm kiếm quá dài"
		}
		f.q = escapeLike(text)
	}
	if categories != nil {
		if len(*categories) > 20 {
			return f, "Quá nhiều nhóm thao tác"
		}
		for _, c := range *categories {
			if !auditCategoryRe.MatchString(c) {
				return f, "Nhóm thao tác không hợp lệ"
			}
		}
		f.categories = *categories
	}
	if actor != nil {
		f.actor = pgtype.UUID{Bytes: *actor, Valid: true}
	}
	if from != nil {
		f.from = pgtype.Timestamptz{Time: *from, Valid: true}
	}
	if to != nil {
		f.to = pgtype.Timestamptz{Time: *to, Valid: true}
	}
	if from != nil && to != nil && !from.Before(*to) {
		return f, "Thời điểm bắt đầu phải trước thời điểm kết thúc"
	}
	return f, ""
}

// auditRow is the common shape of the generated List*AuditRow types.
type auditRow struct {
	ID                           int64
	CreatedAt                    pgtype.Timestamptz
	Action, ObjectType, ObjectID string
	Before, After                []byte
	IP                           string
	UserAgent, RequestID         string
	ActorID                      pgtype.UUID
	ActorEmail, ActorName        string
}

func toAuditEntry(r auditRow) apigen.AuditEntry {
	e := apigen.AuditEntry{
		Id: r.ID, CreatedAt: r.CreatedAt.Time, Action: r.Action, ObjectType: r.ObjectType, ObjectId: r.ObjectID,
		Before: rawJSON(r.Before), After: rawJSON(r.After), Ip: r.IP, UserAgent: r.UserAgent, RequestId: r.RequestID,
	}
	if r.ActorID.Valid {
		e.Actor = &apigen.AuditActorRef{Id: uuid.UUID(r.ActorID.Bytes), Email: r.ActorEmail, DisplayName: r.ActorName}
	}
	return e
}

// rawJSON passes stored snapshots through unchanged; nil stays JSON null.
func rawJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return json.RawMessage(b)
}

func ipOf(ip *netip.Addr) string {
	if ip == nil {
		return ""
	}
	return ip.String()
}

// ListOrgAudit returns the organization's audit trail (owner/admin only).
func (s *Server) ListOrgAudit(ctx context.Context, req apigen.ListOrgAuditRequestObject) (apigen.ListOrgAuditResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.ListOrgAudit403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner/admin được xem audit log"}}, nil
	}
	p := req.Params
	f, msg := parseAuditFilter(p.Page, p.PageSize, p.Q, p.Category, p.ActorId, p.From, p.To)
	if msg != "" {
		return apigen.ListOrgAudit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	rows, err := s.q.ListOrgAudit(ctx, store.ListOrgAuditParams{
		OrganizationID: m.OrgID, ActorID: f.actor, FromTime: f.from, ToTime: f.to,
		Categories: f.categories, Q: f.q, Off: f.offset(), Lim: f.pageSize,
	})
	if err != nil {
		return nil, fmt.Errorf("list org audit: %w", err)
	}
	total, err := s.q.CountOrgAudit(ctx, store.CountOrgAuditParams{
		OrganizationID: m.OrgID, ActorID: f.actor, FromTime: f.from, ToTime: f.to, Categories: f.categories, Q: f.q,
	})
	if err != nil {
		return nil, fmt.Errorf("count org audit: %w", err)
	}
	out := apigen.AuditPage{Entries: make([]apigen.AuditEntry, 0, len(rows)), Total: total, Page: f.page, PageSize: f.pageSize}
	for _, r := range rows {
		out.Entries = append(out.Entries, toAuditEntry(auditRow{
			ID: r.ID, CreatedAt: r.CreatedAt, Action: r.Action, ObjectType: r.ObjectType, ObjectID: r.ObjectID,
			Before: r.Before, After: r.After, IP: ipOf(r.Ip), UserAgent: r.UserAgent, RequestID: r.RequestID,
			ActorID: r.ActorUserID, ActorEmail: r.ActorEmail, ActorName: r.ActorName,
		}))
	}
	return apigen.ListOrgAudit200JSONResponse(out), nil
}

// ListSystemAudit returns events not tied to an organization (system admin; route guard checks the role).
func (s *Server) ListSystemAudit(ctx context.Context, req apigen.ListSystemAuditRequestObject) (apigen.ListSystemAuditResponseObject, error) {
	p := req.Params
	f, msg := parseAuditFilter(p.Page, p.PageSize, p.Q, p.Category, p.ActorId, p.From, p.To)
	if msg != "" {
		return apigen.ListSystemAudit400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	rows, err := s.q.ListSystemAudit(ctx, store.ListSystemAuditParams{
		ActorID: f.actor, FromTime: f.from, ToTime: f.to, Categories: f.categories, Q: f.q, Off: f.offset(), Lim: f.pageSize,
	})
	if err != nil {
		return nil, fmt.Errorf("list system audit: %w", err)
	}
	total, err := s.q.CountSystemAudit(ctx, store.CountSystemAuditParams{
		ActorID: f.actor, FromTime: f.from, ToTime: f.to, Categories: f.categories, Q: f.q,
	})
	if err != nil {
		return nil, fmt.Errorf("count system audit: %w", err)
	}
	out := apigen.AuditPage{Entries: make([]apigen.AuditEntry, 0, len(rows)), Total: total, Page: f.page, PageSize: f.pageSize}
	for _, r := range rows {
		out.Entries = append(out.Entries, toAuditEntry(auditRow{
			ID: r.ID, CreatedAt: r.CreatedAt, Action: r.Action, ObjectType: r.ObjectType, ObjectID: r.ObjectID,
			Before: r.Before, After: r.After, IP: ipOf(r.Ip), UserAgent: r.UserAgent, RequestID: r.RequestID,
			ActorID: r.ActorUserID, ActorEmail: r.ActorEmail, ActorName: r.ActorName,
		}))
	}
	return apigen.ListSystemAudit200JSONResponse(out), nil
}
