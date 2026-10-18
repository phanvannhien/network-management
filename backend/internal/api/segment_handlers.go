package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Segments (P2-08, ADR-047): shared networks cables end in — an MPLS L3VPN, a Metro / VPLS service, a shared LAN.
// Members read, editors write; every write is audited; a segment cables still end in cannot be deleted.

const (
	msgSegmentWrite    = "Chỉ owner, admin hoặc editor được sửa mạng dùng chung"
	msgSegmentNotFound = "Không tìm thấy mạng dùng chung"
	msgSegmentDup      = "Đã có mạng dùng chung tên này"
)

type segmentFields struct {
	name, kind, serviceID, notes string
	vendor                       pgtype.UUID
}

// checkSegment validates the input and that the provider is a vendor of the organization.
func checkSegment(ctx context.Context, q store.Querier, m tenant.Membership, b *apigen.SegmentInput) (segmentFields, string, error) {
	var f segmentFields
	if b == nil {
		return f, "Thiếu dữ liệu", nil
	}
	f.name = strings.TrimSpace(b.Name)
	f.kind = string(b.Kind)
	f.serviceID = strings.TrimSpace(str(b.ServiceId))
	f.notes = str(b.Notes)
	switch {
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên từ 1 đến 100 ký tự", nil
	case !b.Kind.Valid():
		return f, "Loại mạng không hợp lệ", nil
	case tooLong(f.serviceID, 100):
		return f, "Mã dịch vụ tối đa 100 ký tự", nil
	case tooLong(f.notes, 2000):
		return f, "Ghi chú tối đa 2000 ký tự", nil
	}
	if b.VendorId != nil {
		if _, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(*b.VendorId)}); errors.Is(err, pgx.ErrNoRows) {
			return f, "Nhà cung cấp không tồn tại", nil
		} else if err != nil {
			return f, "", fmt.Errorf("get vendor: %w", err)
		}
		f.vendor = pgUUID(*b.VendorId)
	}
	return f, "", nil
}

// segmentLockKey serializes deleting a segment with cabling into it.
func segmentLockKey(m tenant.Membership, id uuid.UUID) string {
	return m.OrgID.String() + "/segment/" + id.String()
}

func segmentView(r store.ListSegmentsRow) apigen.Segment {
	return apigen.Segment{Id: uuid.UUID(r.ID.Bytes), Name: r.Name, Kind: apigen.SegmentKind(r.Kind), VendorId: optUUID(r.VendorID),
		VendorName: r.VendorName, ServiceId: r.ServiceID, Notes: r.Notes, LinkCount: r.LinkCount, Version: r.Version}
}

// listSegments returns the given segments (all when ids is nil) as API objects.
func listSegments(ctx context.Context, q store.Querier, m tenant.Membership, ids []pgtype.UUID) ([]apigen.Segment, error) {
	rows, err := q.ListSegments(ctx, store.ListSegmentsParams{OrganizationID: m.OrgID, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("list segments: %w", err)
	}
	out := make([]apigen.Segment, 0, len(rows))
	for _, r := range rows {
		out = append(out, segmentView(r))
	}
	return out, nil
}

func oneSegment(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (apigen.Segment, bool, error) {
	list, err := listSegments(ctx, q, m, []pgtype.UUID{id})
	if err != nil || len(list) == 0 {
		return apigen.Segment{}, false, err
	}
	return list[0], true, nil
}

func (s *Server) ListSegments(ctx context.Context, req apigen.ListSegmentsRequestObject) (apigen.ListSegmentsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	list, err := listSegments(ctx, s.q, m, nil)
	if err != nil {
		return nil, err
	}
	return apigen.ListSegments200JSONResponse{Segments: list}, nil
}

func (s *Server) GetSegment(ctx context.Context, req apigen.GetSegmentRequestObject) (apigen.GetSegmentResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	sg, ok, err := oneSegment(ctx, s.q, m, pgUUID(req.SegmentId))
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetSegment404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSegmentNotFound)}, nil
	}
	return apigen.GetSegment200JSONResponse(sg), nil
}

func (s *Server) CreateSegment(ctx context.Context, req apigen.CreateSegmentRequestObject) (apigen.CreateSegmentResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateSegment403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgSegmentWrite}}, nil
	}
	var (
		out     apigen.Segment
		bad     string
		dup     bool
		created store.Segment
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		f, msg, err := checkSegment(ctx, q, m, req.Body)
		if err != nil || msg != "" {
			bad = msg
			if err == nil {
				err = errRollback
			}
			return err
		}
		if created, err = q.CreateSegment(ctx, store.CreateSegmentParams{OrganizationID: m.OrgID, Name: f.name, Kind: f.kind,
			VendorID: f.vendor, ServiceID: f.serviceID, Notes: f.notes}); isUnique(err) {
			dup = true
			return errRollback
		} else if err != nil {
			return fmt.Errorf("create segment: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "segment.create",
			ObjectType: "segment", ObjectID: uuidStr(created.ID), After: created, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		out, _, err = oneSegment(ctx, q, m, created.ID)
		return err
	})
	switch {
	case err != nil:
		return nil, err
	case bad != "":
		return apigen.CreateSegment400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case dup:
		return apigen.CreateSegment409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgSegmentDup}}, nil
	}
	return apigen.CreateSegment201JSONResponse(out), nil
}

func (s *Server) UpdateSegment(ctx context.Context, req apigen.UpdateSegmentRequestObject) (apigen.UpdateSegmentResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UpdateSegment403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgSegmentWrite}}, nil
	}
	if req.Body == nil {
		return apigen.UpdateSegment400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	in := apigen.SegmentInput{Name: req.Body.Name, Kind: req.Body.Kind, VendorId: req.Body.VendorId, ServiceId: req.Body.ServiceId,
		Notes: req.Body.Notes}
	var (
		out       apigen.Segment
		bad, conf string
		gone      bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetSegment(ctx, store.GetSegmentParams{OrganizationID: m.OrgID, ID: pgUUID(req.SegmentId)})
		if errors.Is(err, pgx.ErrNoRows) {
			gone = true
			return errRollback
		} else if err != nil {
			return fmt.Errorf("get segment: %w", err)
		}
		f, msg, err := checkSegment(ctx, q, m, &in)
		if err != nil || msg != "" {
			bad = msg
			if err == nil {
				err = errRollback
			}
			return err
		}
		after, err := q.UpdateSegment(ctx, store.UpdateSegmentParams{OrganizationID: m.OrgID, ID: before.ID, Name: f.name, Kind: f.kind,
			VendorID: f.vendor, ServiceID: f.serviceID, Notes: f.notes, Version: req.Body.Version})
		switch {
		case isUnique(err):
			conf = msgSegmentDup
			return errRollback
		case errors.Is(err, pgx.ErrNoRows):
			conf = "Mạng dùng chung vừa được người khác sửa. Tải lại rồi thử lại."
			return errRollback
		case err != nil:
			return fmt.Errorf("update segment: %w", err)
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "segment.update",
			ObjectType: "segment", ObjectID: uuidStr(after.ID), Before: before, After: after, Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		out, _, err = oneSegment(ctx, q, m, after.ID)
		return err
	})
	switch {
	case err != nil:
		return nil, err
	case gone:
		return apigen.UpdateSegment404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSegmentNotFound)}, nil
	case bad != "":
		return apigen.UpdateSegment400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conf != "":
		return apigen.UpdateSegment409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conf}}, nil
	}
	return apigen.UpdateSegment200JSONResponse(out), nil
}

func (s *Server) DeleteSegment(ctx context.Context, req apigen.DeleteSegmentRequestObject) (apigen.DeleteSegmentResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteSegment403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgSegmentWrite}}, nil
	}
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		// Same lock as cabling into it (resolveEnd): no cable can land on a segment being deleted.
		if err := q.AdvisoryXactLock(ctx, segmentLockKey(m, req.SegmentId)); err != nil {
			return fmt.Errorf("lock segment: %w", err)
		}
		sg, err := q.GetSegment(ctx, store.GetSegmentParams{OrganizationID: m.OrgID, ID: pgUUID(req.SegmentId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		} else if err != nil {
			return fmt.Errorf("get segment: %w", err)
		}
		if n, err := q.SegmentLinkCount(ctx, store.SegmentLinkCountParams{OrganizationID: m.OrgID, ID: sg.ID}); err != nil {
			return fmt.Errorf("count segment links: %w", err)
		} else if n > 0 {
			code = 409
			return errRollback
		}
		if _, err := q.DeleteSegment(ctx, store.DeleteSegmentParams{OrganizationID: m.OrgID, ID: sg.ID}); err != nil {
			return fmt.Errorf("delete segment: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "segment.delete", ObjectType: "segment",
			ObjectID: uuidStr(sg.ID), Before: sg, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.DeleteSegment404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSegmentNotFound)}, nil
	case 409:
		return apigen.DeleteSegment409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Còn dây nối vào mạng dùng chung này — xóa các dây trước"}}, nil
	}
	return apigen.DeleteSegment204Response{}, nil
}
