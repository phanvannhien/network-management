package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// The built-in device catalog (ADR-035). Read by any member; copying an entry into the organization's templates
// needs edit rights and is audited like any template creation.

func (s *Server) ListDeviceCatalog(ctx context.Context, req apigen.ListDeviceCatalogRequestObject) (apigen.ListDeviceCatalogResponseObject, error) {
	if _, err := tenant.Require(ctx, req.OrgId); err != nil {
		return nil, err
	}
	return apigen.ListDeviceCatalog200JSONResponse{Models: catalog.All()}, nil
}

func (s *Server) CreateTemplateFromCatalog(ctx context.Context, req apigen.CreateTemplateFromCatalogRequestObject) (apigen.CreateTemplateFromCatalogResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateTemplateFromCatalog403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgTemplateWrite}}, nil
	}
	if req.Body == nil {
		return apigen.CreateTemplateFromCatalog400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	c, ok := catalog.Get(req.Body.CatalogId)
	if !ok {
		return apigen.CreateTemplateFromCatalog404JSONResponse{NotFoundJSONResponse: notFoundBody("Không có model này trong thư viện")}, nil
	}
	name := c.Vendor + " " + c.Model
	pns := make([]string, 0, len(c.PartNumbers))
	for _, p := range c.PartNumbers {
		pns = append(pns, strings.ToLower(p))
	}
	partNumber := ""
	if len(c.PartNumbers) > 0 {
		partNumber = c.PartNumbers[0]
	}
	notes := "Từ thư viện có sẵn (" + c.Id + ")"
	if !c.Verified {
		notes += " — chưa đối chiếu datasheet, cần kiểm tra"
	}
	var (
		tpl     store.DeviceTemplate
		created bool
		bad     string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		existing, err := q.FindTemplateForCatalog(ctx, store.FindTemplateForCatalogParams{
			OrganizationID: m.OrgID, Name: name, Type: string(c.Type), Model: c.Model, PartNumbers: pns,
		})
		if err == nil {
			tpl = existing
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find template: %w", err)
		}
		ports := c.Ports
		u := c.UHeight
		f, msg := validateTemplate(name, c.Type, &c.Vendor, &c.Model, &partNumber, &notes, &u, &ports)
		if msg != "" {
			bad = msg
			return errRollback
		}
		tpl, err = q.CreateDeviceTemplate(ctx, store.CreateDeviceTemplateParams{
			OrganizationID: m.OrgID, Name: f.name, Type: f.typ, Vendor: f.vendor, Model: f.model, PartNumber: f.partNumber,
			UHeight: f.uHeight, Ports: f.ports, Notes: f.notes,
		})
		if err != nil {
			return fmt.Errorf("create template: %w", err)
		}
		created = true
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "template.create", ObjectType: "device_template",
			ObjectID: uuidStr(tpl.ID), After: snapTemplate(tpl), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case err != nil:
		return nil, err
	case bad != "":
		return apigen.CreateTemplateFromCatalog400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case created:
		return apigen.CreateTemplateFromCatalog201JSONResponse(toTemplate(tpl)), nil
	}
	return apigen.CreateTemplateFromCatalog200JSONResponse(toTemplate(tpl)), nil
}
