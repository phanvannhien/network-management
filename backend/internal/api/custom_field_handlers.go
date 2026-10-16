package api

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Custom device fields (P1-08, SRS §4.1 "Mở rộng"): declared per organization by owners/admins; every member
// reads the definitions to render the device form. Key and kind are fixed once created (stored values use them).

var customKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

const msgFieldNotFound = "Không tìm thấy trường tùy biến"

func toCustomField(d store.CustomFieldDef) apigen.CustomField {
	opts := d.Options
	if opts == nil {
		opts = []string{}
	}
	return apigen.CustomField{
		Id: uuid.UUID(d.ID.Bytes), Key: d.Key, Label: d.Label, Kind: apigen.CustomFieldKind(d.Kind), Options: opts,
		Required: d.Required, SortOrder: d.SortOrder, Version: d.Version,
	}
}

type fieldSnapshot struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"`
	Options  []string `json:"options"`
	Required bool     `json:"required"`
}

func snapField(d store.CustomFieldDef) fieldSnapshot {
	return fieldSnapshot{d.Key, d.Label, d.Kind, d.Options, d.Required}
}

// normalizeOptions trims and de-duplicates select options; a select needs at least one.
func normalizeOptions(kind string, in *[]string) ([]string, string) {
	out := []string{}
	if in != nil {
		for _, o := range *in {
			if o = strings.TrimSpace(o); o != "" && !slices.Contains(out, o) {
				if tooLong(o, 100) {
					return nil, "Lựa chọn tối đa 100 ký tự"
				}
				out = append(out, o)
			}
		}
	}
	switch {
	case kind == "select" && len(out) == 0:
		return nil, "Trường kiểu danh sách cần ít nhất một lựa chọn"
	case kind != "select" && len(out) > 0:
		return nil, "Chỉ trường kiểu danh sách có lựa chọn"
	case len(out) > 100:
		return nil, "Tối đa 100 lựa chọn"
	}
	return out, ""
}

func (s *Server) ListCustomFields(ctx context.Context, req apigen.ListCustomFieldsRequestObject) (apigen.ListCustomFieldsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	defs, err := s.q.ListCustomFieldDefs(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("list custom fields: %w", err)
	}
	out := apigen.CustomFieldList{Fields: make([]apigen.CustomField, 0, len(defs))}
	for _, d := range defs {
		out.Fields = append(out.Fields, toCustomField(d))
	}
	return apigen.ListCustomFields200JSONResponse(out), nil
}

func (s *Server) CreateCustomField(ctx context.Context, req apigen.CreateCustomFieldRequestObject) (apigen.CreateCustomFieldResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanAdmin() {
		return apigen.CreateCustomField403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgOrgWideAdmin}}, nil
	}
	bad := func(msg string) (apigen.CreateCustomFieldResponseObject, error) {
		return apigen.CreateCustomField400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil {
		return bad("Thiếu dữ liệu")
	}
	label := strings.TrimSpace(b.Label)
	switch {
	case !customKeyRe.MatchString(b.Key):
		return bad("Mã trường: chữ thường, số, gạch dưới, bắt đầu bằng chữ, tối đa 40 ký tự (vd ma_tai_san)")
	case label == "" || tooLong(label, 100):
		return bad("Tên trường bắt buộc, tối đa 100 ký tự")
	case !b.Kind.Valid():
		return bad("Kiểu trường không hợp lệ")
	}
	opts, msg := normalizeOptions(string(b.Kind), b.Options)
	if msg != "" {
		return bad(msg)
	}
	var (
		created   store.CustomFieldDef
		duplicate bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		created, err = q.CreateCustomFieldDef(ctx, store.CreateCustomFieldDefParams{
			OrganizationID: m.OrgID, Key: b.Key, Label: label, Kind: string(b.Kind), Options: opts,
			Required: b.Required != nil && *b.Required, SortOrder: derefInt32(b.SortOrder),
		})
		if isUniqueViolation(err) {
			duplicate = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create custom field: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "custom_field.create", ObjectType: "custom_field",
			ObjectID: uuidStr(created.ID), After: snapField(created), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case duplicate:
		return apigen.CreateCustomField409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Mã trường đã tồn tại"}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateCustomField201JSONResponse(toCustomField(created)), nil
}

func derefInt32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

func (s *Server) UpdateCustomField(ctx context.Context, req apigen.UpdateCustomFieldRequestObject) (apigen.UpdateCustomFieldResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateCustomField400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		updated             store.CustomFieldDef
		notFound, forbidden bool
		bad, conflict       string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetCustomFieldDef(ctx, store.GetCustomFieldDefParams{ID: pgUUID(req.FieldId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load custom field: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		label := strings.TrimSpace(b.Label)
		if label == "" || tooLong(label, 100) {
			bad = "Tên trường bắt buộc, tối đa 100 ký tự"
			return errRollback
		}
		opts, msg := normalizeOptions(before.Kind, b.Options)
		if msg != "" {
			bad = msg
			return errRollback
		}
		updated, err = q.UpdateCustomFieldDef(ctx, store.UpdateCustomFieldDefParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Label: label, Options: opts,
			Required: b.Required != nil && *b.Required, SortOrder: derefInt32(b.SortOrder),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			conflict = msgStale
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update custom field: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "custom_field.update", ObjectType: "custom_field",
			ObjectID: uuidStr(before.ID), Before: snapField(before), After: snapField(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateCustomField404JSONResponse{NotFoundJSONResponse: notFoundBody(msgFieldNotFound)}, nil
	case forbidden:
		return apigen.UpdateCustomField403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgOrgWideAdmin}}, nil
	case bad != "":
		return apigen.UpdateCustomField400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.UpdateCustomField409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateCustomField200JSONResponse(toCustomField(updated)), nil
}

func (s *Server) DeleteCustomField(ctx context.Context, req apigen.DeleteCustomFieldRequestObject) (apigen.DeleteCustomFieldResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var notFound, forbidden bool
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetCustomFieldDef(ctx, store.GetCustomFieldDefParams{ID: pgUUID(req.FieldId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load custom field: %w", err)
		}
		if !m.CanAdmin() {
			forbidden = true
			return errRollback
		}
		if _, err := q.DeleteCustomFieldDef(ctx, store.DeleteCustomFieldDefParams{ID: before.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete custom field: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "custom_field.delete", ObjectType: "custom_field",
			ObjectID: uuidStr(before.ID), Before: snapField(before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteCustomField404JSONResponse{NotFoundJSONResponse: notFoundBody(msgFieldNotFound)}, nil
	case forbidden:
		return apigen.DeleteCustomField403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgOrgWideAdmin}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteCustomField204Response{}, nil
}
