package api

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Category tree (P1-27, ADR-032): free-depth categories under the organization; a site belongs to one of them or to
// the organization itself, and its full code is derived from the path: <ORG>-<category>-…-<site>. Any change that
// re-codes sites (category code, move, organization code) lists the changes first and needs an explicit confirmation.

const (
	msgCategoryNotFound = "Không tìm thấy danh mục"
	maxCategoryDepth    = 8
)

var (
	categoryCodeRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,11}$`)
	siteLocalRe    = regexp.MustCompile(`^[A-Z0-9]{1,12}$`)
)

type catNode struct {
	id, parent pgtype.UUID
	code, name string
}

type categoryTree map[pgtype.UUID]catNode

func loadTree(ctx context.Context, q store.Querier, m tenant.Membership) (categoryTree, []store.ListCategoriesRow, error) {
	rows, err := q.ListCategories(ctx, m.OrgID)
	if err != nil {
		return nil, nil, fmt.Errorf("list categories: %w", err)
	}
	t := categoryTree{}
	for _, r := range rows {
		t[r.ID] = catNode{r.ID, r.ParentID, r.Code, r.Name}
	}
	return t, rows, nil
}

// chain is the categories from the root down to id (empty for the organization level).
func (t categoryTree) chain(id pgtype.UUID) []catNode {
	var out []catNode
	for seen := 0; id.Valid && seen <= len(t); seen++ {
		n, ok := t[id]
		if !ok {
			break
		}
		out = append([]catNode{n}, out...)
		id = n.parent
	}
	return out
}

func (t categoryTree) path(id pgtype.UUID) string {
	names := []string{}
	for _, n := range t.chain(id) {
		names = append(names, n.name)
	}
	return strings.Join(names, " › ")
}

// isUnder reports whether id is node or one of its descendants.
func (t categoryTree) isUnder(id, node pgtype.UUID) bool {
	for _, n := range t.chain(id) {
		if n.id == node {
			return true
		}
	}
	return false
}

func fullSiteCode(orgCode string, t categoryTree, category pgtype.UUID, local string) string {
	parts := []string{orgCode}
	for _, n := range t.chain(category) {
		parts = append(parts, n.code)
	}
	return strings.Join(append(parts, local), "-")
}

type codeChange struct {
	site     pgtype.UUID
	name     string
	from, to string
}

// siteCodeChanges compares every live site's code with the one the given tree and organization code produce, and
// reports a clash when two sites would end up with the same code.
func siteCodeChanges(ctx context.Context, q store.Querier, m tenant.Membership, orgCode string, t categoryTree) ([]codeChange, string, error) {
	sites, err := q.ListSiteCodes(ctx, m.OrgID)
	if err != nil {
		return nil, "", fmt.Errorf("list site codes: %w", err)
	}
	var out []codeChange
	taken := map[string]string{}
	for _, s := range sites {
		to := fullSiteCode(orgCode, t, s.CategoryID, s.LocalCode)
		key := strings.ToLower(to)
		if other, ok := taken[key]; ok {
			return nil, fmt.Sprintf("Mã site %s sẽ bị trùng giữa %s và %s", to, other, s.Name), nil
		}
		taken[key] = s.Name
		if to != s.Code {
			out = append(out, codeChange{s.ID, s.Name, s.Code, to})
		}
	}
	return out, "", nil
}

// applyCodeChanges writes new site codes in two steps so that swaps never trip the unique index, auditing each.
func applyCodeChanges(ctx context.Context, q store.Querier, m tenant.Membership, changes []codeChange) error {
	for _, c := range changes {
		if err := q.SetSiteCode(ctx, store.SetSiteCodeParams{ID: c.site, OrganizationID: m.OrgID, Code: "~" + uuidStr(c.site)}); err != nil {
			return fmt.Errorf("park site code: %w", err)
		}
	}
	for _, c := range changes {
		if err := q.SetSiteCode(ctx, store.SetSiteCodeParams{ID: c.site, OrganizationID: m.OrgID, Code: c.to}); err != nil {
			return fmt.Errorf("set site code: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "site.recode", ObjectType: "site",
			ObjectID: uuidStr(c.site), Before: map[string]string{"code": c.from}, After: map[string]string{"code": c.to}, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
	}
	return nil
}

func toCodeChanges(changes []codeChange) apigen.SiteCodeChanges {
	out := apigen.SiteCodeChanges{}
	for _, c := range changes {
		out.Changes = append(out.Changes, struct {
			From   string             `json:"from"`
			Name   string             `json:"name"`
			SiteId openapi_types.UUID `json:"siteId"`
			To     string             `json:"to"`
		}{c.from, c.name, uuid.UUID(c.site.Bytes), c.to})
	}
	if out.Changes == nil {
		out.Changes = make([]struct {
			From   string             `json:"from"`
			Name   string             `json:"name"`
			SiteId openapi_types.UUID `json:"siteId"`
			To     string             `json:"to"`
		}, 0)
	}
	return out
}

func orgCode(ctx context.Context, q store.Querier, m tenant.Membership) (string, error) {
	o, err := q.GetOrganization(ctx, m.OrgID)
	if err != nil {
		return "", fmt.Errorf("load organization: %w", err)
	}
	return o.Code, nil
}

func toCategory(r store.ListCategoriesRow, t categoryTree) apigen.Category {
	return apigen.Category{
		Id: uuid.UUID(r.ID.Bytes), ParentId: optUUID(r.ParentID), Name: r.Name, Code: r.Code, Path: t.path(r.ID),
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, Notes: r.Notes,
		ChildCount: r.ChildCount, SiteCount: r.SiteCount, Version: r.Version,
	}
}

type categoryFields struct {
	parent                                                     pgtype.UUID
	name, code, contactName, contactPhone, contactEmail, notes string
}

func validateCategory(b apigen.CategoryInput) (categoryFields, string) {
	f := categoryFields{name: strings.TrimSpace(b.Name), code: strings.ToUpper(strings.TrimSpace(b.Code)),
		contactName: str(b.ContactName), contactPhone: str(b.ContactPhone), contactEmail: str(b.ContactEmail), notes: str(b.Notes)}
	if b.ParentId != nil {
		f.parent = pgUUID(*b.ParentId)
	}
	switch {
	case f.name == "" || tooLong(f.name, 200):
		return f, "Tên danh mục bắt buộc, tối đa 200 ký tự"
	case !categoryCodeRe.MatchString(f.code):
		return f, "Mã danh mục 2–12 ký tự A–Z, 0–9, bắt đầu bằng chữ (vd CJFEED)"
	case tooLong(f.contactName, 200) || tooLong(f.contactPhone, 50) || tooLong(f.contactEmail, 320) || tooLong(f.notes, 2000):
		return f, "Một trường vượt quá độ dài cho phép"
	}
	return f, ""
}

type categorySnapshot struct {
	Name   string `json:"name"`
	Code   string `json:"code"`
	Parent string `json:"parent,omitempty"`
}

func (s *Server) ListCategories(ctx context.Context, req apigen.ListCategoriesRequestObject) (apigen.ListCategoriesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	t, rows, err := loadTree(ctx, s.q, m)
	if err != nil {
		return nil, err
	}
	out := apigen.CategoryList{Categories: make([]apigen.Category, 0, len(rows))}
	for _, r := range rows {
		out.Categories = append(out.Categories, toCategory(r, t))
	}
	return apigen.ListCategories200JSONResponse(out), nil
}

// planCategory applies f to the tree (id nil = new) and checks the parent, depth, cycles and sibling codes.
func planCategory(t categoryTree, f categoryFields, id pgtype.UUID) (categoryTree, string) {
	if f.parent.Valid {
		if _, ok := t[f.parent]; !ok {
			return nil, "Danh mục cha không tồn tại"
		}
		if id.Valid && t.isUnder(f.parent, id) {
			return nil, "Không chuyển được danh mục vào chính nó hoặc danh mục con của nó"
		}
	}
	next := categoryTree{}
	for k, v := range t {
		next[k] = v
	}
	key := id
	if !key.Valid {
		key = pgUUID(uuid.New()) // placeholder for the depth check
	}
	next[key] = catNode{key, f.parent, f.code, f.name}
	if len(next.chain(key)) > maxCategoryDepth {
		return nil, fmt.Sprintf("Cây danh mục tối đa %d cấp", maxCategoryDepth)
	}
	for k, v := range next {
		if k != key && v.parent == f.parent && v.code == f.code {
			return nil, fmt.Sprintf("Đã có danh mục mã %s cùng cấp", f.code)
		}
	}
	return next, ""
}

func (s *Server) CreateCategory(ctx context.Context, req apigen.CreateCategoryRequestObject) (apigen.CreateCategoryResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateCategory403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	if req.Body == nil {
		return apigen.CreateCategory400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, bad := validateCategory(*req.Body)
	var out apigen.Category
	conflict := false
	err = s.withTx(ctx, func(q store.Querier) error {
		if bad != "" {
			return errRollback
		}
		t, _, err := loadTree(ctx, q, m)
		if err != nil {
			return err
		}
		if _, msg := planCategory(t, f, pgtype.UUID{}); msg != "" {
			bad = msg
			return errRollback
		}
		c, err := q.CreateCategory(ctx, store.CreateCategoryParams{OrganizationID: m.OrgID, ParentID: f.parent, Code: f.code, Name: f.name,
			ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes})
		if isUniqueViolation(err) {
			conflict = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create category: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "category.create", ObjectType: "category",
			ObjectID: uuidStr(c.ID), After: categorySnapshot{c.Name, c.Code, t.path(c.ParentID)}, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		t2, rows, err := loadTree(ctx, q, m)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if r.ID == c.ID {
				out = toCategory(r, t2)
			}
		}
		return nil
	})
	switch {
	case err != nil:
		return nil, err
	case bad != "":
		return apigen.CreateCategory400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict:
		return apigen.CreateCategory409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: fmt.Sprintf("Đã có danh mục mã %s cùng cấp", f.code)}}, nil
	}
	return apigen.CreateCategory201JSONResponse(out), nil
}

func categoryInputOf(b apigen.CategoryUpdate) apigen.CategoryInput {
	return apigen.CategoryInput{ParentId: b.ParentId, Name: b.Name, Code: b.Code, ContactName: b.ContactName, ContactPhone: b.ContactPhone,
		ContactEmail: b.ContactEmail, Notes: b.Notes}
}

// categoryChange is the planned effect of an update: the new tree and the site codes it changes.
func (s *Server) categoryChange(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID, b apigen.CategoryUpdate) (store.Category, categoryFields, []codeChange, string, bool, error) {
	before, err := q.GetCategory(ctx, store.GetCategoryParams{ID: pgUUID(id), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return before, categoryFields{}, nil, "", false, nil
	}
	if err != nil {
		return before, categoryFields{}, nil, "", false, fmt.Errorf("load category: %w", err)
	}
	f, bad := validateCategory(categoryInputOf(b))
	if bad != "" {
		return before, f, nil, bad, true, nil
	}
	t, _, err := loadTree(ctx, q, m)
	if err != nil {
		return before, f, nil, "", true, err
	}
	next, bad := planCategory(t, f, before.ID)
	if bad != "" {
		return before, f, nil, bad, true, nil
	}
	code, err := orgCode(ctx, q, m)
	if err != nil {
		return before, f, nil, "", true, err
	}
	changes, bad, err := siteCodeChanges(ctx, q, m, code, next)
	return before, f, changes, bad, true, err
}

func (s *Server) PreviewCategoryUpdate(ctx context.Context, req apigen.PreviewCategoryUpdateRequestObject) (apigen.PreviewCategoryUpdateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.PreviewCategoryUpdate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	if req.Body == nil {
		return apigen.PreviewCategoryUpdate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	_, _, changes, bad, found, err := s.categoryChange(ctx, s.q, m, req.CategoryId, *req.Body)
	switch {
	case err != nil:
		return nil, err
	case !found:
		return apigen.PreviewCategoryUpdate404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCategoryNotFound)}, nil
	case bad != "":
		return apigen.PreviewCategoryUpdate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	}
	return apigen.PreviewCategoryUpdate200JSONResponse(toCodeChanges(changes)), nil
}

func (s *Server) UpdateCategory(ctx context.Context, req apigen.UpdateCategoryRequestObject) (apigen.UpdateCategoryResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UpdateCategory403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateCategory400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out       apigen.Category
		bad, conf string
		found     bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, f, changes, msg, ok, err := s.categoryChange(ctx, q, m, req.CategoryId, *b)
		found = ok
		if err != nil || !ok || msg != "" {
			bad = msg
			return orRollback(err)
		}
		if len(changes) > 0 && (b.ConfirmSiteCodes == nil || !*b.ConfirmSiteCodes) {
			bad = fmt.Sprintf("Thay đổi này đổi mã %d site — xem trước và xác nhận", len(changes))
			return errRollback
		}
		t, _, err := loadTree(ctx, q, m)
		if err != nil {
			return err
		}
		n, err := q.UpdateCategory(ctx, store.UpdateCategoryParams{ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, ParentID: f.parent,
			Code: f.code, Name: f.name, ContactName: f.contactName, ContactPhone: f.contactPhone, ContactEmail: f.contactEmail, Notes: f.notes})
		if isUniqueViolation(err) {
			conf = fmt.Sprintf("Đã có danh mục mã %s cùng cấp", f.code)
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update category: %w", err)
		}
		if n == 0 {
			conf = msgStale
			return errRollback
		}
		if err := applyCodeChanges(ctx, q, m, changes); err != nil {
			return err
		}
		t2, rows, err := loadTree(ctx, q, m)
		if err != nil {
			return err
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "category.update", ObjectType: "category",
			ObjectID: uuidStr(before.ID), Before: categorySnapshot{before.Name, before.Code, t.path(before.ParentID)},
			After: categorySnapshot{f.name, f.code, t2.path(f.parent)}, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		for _, r := range rows {
			if r.ID == before.ID {
				out = toCategory(r, t2)
			}
		}
		return nil
	})
	switch {
	case err != nil:
		return nil, err
	case !found:
		return apigen.UpdateCategory404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCategoryNotFound)}, nil
	case bad != "":
		return apigen.UpdateCategory400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conf != "":
		return apigen.UpdateCategory409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conf}}, nil
	}
	return apigen.UpdateCategory200JSONResponse(out), nil
}

func (s *Server) DeleteCategory(ctx context.Context, req apigen.DeleteCategoryRequestObject) (apigen.DeleteCategoryResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteCategory403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	var conf string
	found := true
	err = s.withTx(ctx, func(q store.Querier) error {
		t, rows, err := loadTree(ctx, q, m)
		if err != nil {
			return err
		}
		var row *store.ListCategoriesRow
		for i := range rows {
			if rows[i].ID == pgUUID(req.CategoryId) {
				row = &rows[i]
			}
		}
		if row == nil {
			found = false
			return errRollback
		}
		if row.ChildCount > 0 || row.SiteCount > 0 {
			conf = fmt.Sprintf("Danh mục còn %d danh mục con và %d site — chuyển hoặc xóa trước", row.ChildCount, row.SiteCount)
			return errRollback
		}
		if _, err := q.DeleteCategory(ctx, store.DeleteCategoryParams{ID: row.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete category: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "category.delete", ObjectType: "category",
			ObjectID: uuidStr(row.ID), Before: categorySnapshot{row.Name, row.Code, t.path(row.ParentID)}, Meta: infoFrom(ctx).meta})
	})
	switch {
	case err != nil:
		return nil, err
	case !found:
		return apigen.DeleteCategory404JSONResponse{NotFoundJSONResponse: notFoundBody(msgCategoryNotFound)}, nil
	case conf != "":
		return apigen.DeleteCategory409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conf}}, nil
	}
	return apigen.DeleteCategory204Response{}, nil
}

func (s *Server) PreviewOrganizationCode(ctx context.Context, req apigen.PreviewOrganizationCodeRequestObject) (apigen.PreviewOrganizationCodeResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	code := strings.ToUpper(strings.TrimSpace(req.Params.Code))
	if !categoryCodeRe.MatchString(code) {
		return apigen.PreviewOrganizationCode400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msgOrgCode}}, nil
	}
	t, _, err := loadTree(ctx, s.q, m)
	if err != nil {
		return nil, err
	}
	changes, bad, err := siteCodeChanges(ctx, s.q, m, code, t)
	if err != nil {
		return nil, err
	}
	if bad != "" {
		return apigen.PreviewOrganizationCode400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	}
	return apigen.PreviewOrganizationCode200JSONResponse(toCodeChanges(changes)), nil
}

const msgOrgCode = "Mã tổ chức 2–12 ký tự A–Z, 0–9, bắt đầu bằng chữ (vd CJ)"
