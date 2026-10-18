package api

import (
	"context"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// RecordExport writes the audit entry of an export made in the browser (P1-22, P1-05): the file never reaches the
// server, but who exported what and when is still recorded. A diagram must be one the caller can see.
func (s *Server) RecordExport(ctx context.Context, req apigen.RecordExportRequestObject) (apigen.RecordExportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil || !b.Kind.Valid() {
		return apigen.RecordExport400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Loại export không hợp lệ"}}, nil
	}
	entry := audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "export." + string(b.Kind), Meta: infoFrom(ctx).meta}
	after := map[string]any{}
	switch b.Kind {
	case apigen.DiagramPng, apigen.DiagramSvg, apigen.DiagramPdf:
		if b.DiagramId == nil {
			return apigen.RecordExport400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu sơ đồ"}}, nil
		}
		d, _, ok, err := loadDiagram(ctx, s.q, m, *b.DiagramId)
		if err != nil {
			return nil, err
		}
		if !ok {
			return apigen.RecordExport404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDiagramNotFound)}, nil
		}
		entry.ObjectType, entry.ObjectID = "diagram", uuidStr(d.ID)
		after["name"] = d.Name
		if b.Scale != nil {
			after["scale"] = *b.Scale
		}
		if b.Paper != nil {
			after["paper"] = string(*b.Paper)
		}
		if b.Kind == apigen.DiagramPdf && b.Count != nil {
			after["sheets"] = *b.Count
		}
	case apigen.DevicesXlsx:
		entry.ObjectType = "device"
		if b.Count != nil {
			after["rows"] = *b.Count
		}
	}
	entry.After = after
	if err := s.withTx(ctx, func(q store.Querier) error { return audit.Write(ctx, q, entry) }); err != nil {
		return nil, err
	}
	return apigen.RecordExport204Response{}, nil
}
