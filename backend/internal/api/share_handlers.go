package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Site shares (P1-07c, ADR-029/031): a site is shared to a partner (reaching all its units) or to one unit,
// read-only or editable. Managed by whoever has admin access on the site: organization owners/admins, the
// partner_admin / unit_admin of the site's owner. Shares are never re-shared and never give admin.

const (
	msgShareNotFound  = "Không tìm thấy chia sẻ"
	msgShareForbidden = "Chỉ admin của tổ chức, đối tác hoặc đơn vị sở hữu site được chia sẻ site"
)

type shareSnapshot struct {
	Site       string `json:"siteId"`
	TargetType string `json:"targetType"`
	Target     string `json:"targetId"`
	TargetCode string `json:"targetCode,omitempty"`
	Access     string `json:"access"`
}

func toShare(r store.ListSiteSharesRow) apigen.SiteShare {
	target := r.TargetPartnerID
	if r.TargetUnitID.Valid {
		target = r.TargetUnitID
	}
	return apigen.SiteShare{
		Id: uuid.UUID(r.ID.Bytes), TargetType: apigen.ShareTargetType(r.TargetType), TargetId: uuid.UUID(target.Bytes),
		TargetCode: r.TargetCode, TargetName: r.TargetName, Access: apigen.ShareAccess(r.Access),
		GrantedAt: r.GrantedAt.Time, Version: r.Version,
	}
}

// shareSite loads the site for a share operation: 404 when not visible, 403 below admin.
func (s *Server) shareSite(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetSiteRow, int, error) {
	site, ok, err := loadSite(ctx, q, m, id)
	if err != nil {
		return site, 0, err
	}
	if !ok {
		return site, 404, nil
	}
	level, err := siteLevel(ctx, q, m, site)
	if err != nil {
		return site, 0, err
	}
	if level < tenant.LevelAdmin {
		return site, 403, nil
	}
	return site, 0, nil
}

func findShare(ctx context.Context, q store.Querier, m tenant.Membership, site, share pgtype.UUID) (store.ListSiteSharesRow, bool, error) {
	rows, err := q.ListSiteShares(ctx, store.ListSiteSharesParams{OrganizationID: m.OrgID, SiteID: site})
	if err != nil {
		return store.ListSiteSharesRow{}, false, fmt.Errorf("list site shares: %w", err)
	}
	for _, r := range rows {
		if r.ID == share {
			return r, true, nil
		}
	}
	return store.ListSiteSharesRow{}, false, nil
}

func snapShare(site pgtype.UUID, r store.ListSiteSharesRow) shareSnapshot {
	t := toShare(r)
	return shareSnapshot{uuidStr(site), string(t.TargetType), t.TargetId.String(), r.TargetCode, r.Access}
}

func (s *Server) ListSiteShares(ctx context.Context, req apigen.ListSiteSharesRequestObject) (apigen.ListSiteSharesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	site, code, err := s.shareSite(ctx, s.q, m, req.SiteId)
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.ListSiteShares404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSiteNotFound)}, nil
	case code == 403:
		return apigen.ListSiteShares403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgShareForbidden}}, nil
	}
	rows, err := s.q.ListSiteShares(ctx, store.ListSiteSharesParams{OrganizationID: m.OrgID, SiteID: site.ID})
	if err != nil {
		return nil, fmt.Errorf("list site shares: %w", err)
	}
	out := apigen.SiteShareList{Shares: make([]apigen.SiteShare, 0, len(rows))}
	for _, r := range rows {
		out.Shares = append(out.Shares, toShare(r))
	}
	return apigen.ListSiteShares200JSONResponse(out), nil
}

func (s *Server) CreateSiteShare(ctx context.Context, req apigen.CreateSiteShareRequestObject) (apigen.CreateSiteShareResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || !req.Body.TargetType.Valid() || !req.Body.Access.Valid() {
		return apigen.CreateSiteShare400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Dữ liệu chia sẻ không hợp lệ"}}, nil
	}
	b := req.Body
	var (
		created       store.ListSiteSharesRow
		code          int
		bad, conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var site store.GetSiteRow
		if site, code, err = s.shareSite(ctx, q, m, req.SiteId); err != nil || code != 0 {
			if err == nil {
				err = errRollback
			}
			return err
		}
		// The target is any live partner / unit of this organization (sharing outside one's own partner is
		// the point); the owning partner / unit already sees the site.
		params := store.CreateSiteShareParams{
			OrganizationID: m.OrgID, SiteID: site.ID, TargetType: string(b.TargetType), Access: string(b.Access), GrantedBy: m.UserID,
		}
		if b.TargetType == apigen.ShareTargetTypePartner {
			p, err := q.GetPartner(ctx, store.GetPartnerParams{ID: pgUUID(b.TargetId), OrganizationID: m.OrgID})
			if errors.Is(err, pgx.ErrNoRows) {
				bad = msgPartnerNotFound
				return errRollback
			} else if err != nil {
				return fmt.Errorf("load partner: %w", err)
			}
			if site.PartnerID == p.ID {
				bad = "Site đã thuộc đối tác này"
				return errRollback
			}
			params.TargetPartnerID = p.ID
		} else {
			u, err := q.GetBusinessUnit(ctx, store.GetBusinessUnitParams{ID: pgUUID(b.TargetId), OrganizationID: m.OrgID})
			if errors.Is(err, pgx.ErrNoRows) {
				bad = msgUnitMissing
				return errRollback
			} else if err != nil {
				return fmt.Errorf("load business unit: %w", err)
			}
			if site.BusinessUnitID == u.ID {
				bad = "Site đã thuộc đơn vị này"
				return errRollback
			}
			params.TargetUnitID = u.ID
		}
		id, err := q.CreateSiteShare(ctx, params)
		if isUniqueViolation(err) {
			conflict = "Site đã được chia sẻ cho đích này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create share: %w", err)
		}
		row, _, err := findShare(ctx, q, m, site.ID, id)
		if err != nil {
			return err
		}
		created = row
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "share.create", ObjectType: "site", ObjectID: uuidStr(site.ID),
			After: snapShare(site.ID, row), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case code == 404:
		return apigen.CreateSiteShare404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSiteNotFound)}, nil
	case code == 403:
		return apigen.CreateSiteShare403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgShareForbidden}}, nil
	case bad != "":
		return apigen.CreateSiteShare400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	case conflict != "":
		return apigen.CreateSiteShare409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateSiteShare201JSONResponse(toShare(created)), nil
}

func (s *Server) UpdateSiteShare(ctx context.Context, req apigen.UpdateSiteShareRequestObject) (apigen.UpdateSiteShareResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || !req.Body.Access.Valid() {
		return apigen.UpdateSiteShare400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Quyền chia sẻ không hợp lệ"}}, nil
	}
	var (
		updated  store.ListSiteSharesRow
		code     int
		missing  bool
		conflict string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var site store.GetSiteRow
		if site, code, err = s.shareSite(ctx, q, m, req.SiteId); err != nil || code != 0 {
			if err == nil {
				err = errRollback
			}
			return err
		}
		before, ok, err := findShare(ctx, q, m, site.ID, pgUUID(req.ShareId))
		if err != nil {
			return err
		}
		if !ok {
			missing = true
			return errRollback
		}
		n, err := q.UpdateSiteShare(ctx, store.UpdateSiteShareParams{
			ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID, Access: string(req.Body.Access), Version: req.Body.Version,
		})
		if err != nil {
			return fmt.Errorf("update share: %w", err)
		}
		if n == 0 {
			conflict = msgStale
			return errRollback
		}
		if updated, _, err = findShare(ctx, q, m, site.ID, before.ID); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "share.update", ObjectType: "site", ObjectID: uuidStr(site.ID),
			Before: snapShare(site.ID, before), After: snapShare(site.ID, updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case code == 404:
		return apigen.UpdateSiteShare404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSiteNotFound)}, nil
	case code == 403:
		return apigen.UpdateSiteShare403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgShareForbidden}}, nil
	case missing:
		return apigen.UpdateSiteShare404JSONResponse{NotFoundJSONResponse: notFoundBody(msgShareNotFound)}, nil
	case conflict != "":
		return apigen.UpdateSiteShare409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateSiteShare200JSONResponse(toShare(updated)), nil
}

func (s *Server) DeleteSiteShare(ctx context.Context, req apigen.DeleteSiteShareRequestObject) (apigen.DeleteSiteShareResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var (
		code    int
		missing bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var site store.GetSiteRow
		if site, code, err = s.shareSite(ctx, q, m, req.SiteId); err != nil || code != 0 {
			if err == nil {
				err = errRollback
			}
			return err
		}
		before, ok, err := findShare(ctx, q, m, site.ID, pgUUID(req.ShareId))
		if err != nil {
			return err
		}
		if !ok {
			missing = true
			return errRollback
		}
		if _, err := q.DeleteSiteShare(ctx, store.DeleteSiteShareParams{ID: before.ID, OrganizationID: m.OrgID, SiteID: site.ID}); err != nil {
			return fmt.Errorf("delete share: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "share.delete", ObjectType: "site", ObjectID: uuidStr(site.ID),
			Before: snapShare(site.ID, before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case code == 404:
		return apigen.DeleteSiteShare404JSONResponse{NotFoundJSONResponse: notFoundBody(msgSiteNotFound)}, nil
	case code == 403:
		return apigen.DeleteSiteShare403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgShareForbidden}}, nil
	case missing:
		return apigen.DeleteSiteShare404JSONResponse{NotFoundJSONResponse: notFoundBody(msgShareNotFound)}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteSiteShare204Response{}, nil
}
