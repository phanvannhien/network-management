package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Vendor end-of-sale / end-of-support dates from the model library (P2-22).

// calendarToday is today's date where the server runs (set TZ for the organization's country), at midnight UTC so it
// compares with date columns.
func calendarToday() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

// catalogDate turns a library date (YYYY-MM-DD, checked when the catalog loads) into a column value.
func catalogDate(s string) pgtype.Date {
	t, err := time.Parse(time.DateOnly, s)
	if s == "" || err != nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: t, Valid: true}
}

// lifecycleFor is the library model of a device: the one it was made from while its model / part number still name it
// (a device renamed to another model since takes the new one's dates), else the one its model / part number names.
func lifecycleFor(catalogID, model, partNumber, typ string) apigen.CatalogLifecycle {
	if c, ok := catalog.Get(catalogID); catalogID != "" && ok && catalog.Names(c, model, partNumber) {
		return c.Lifecycle
	}
	if c, ok := catalog.Match(model, partNumber, typ); ok {
		return c.Lifecycle
	}
	return apigen.CatalogLifecycle{}
}

// fillDates keeps the dates a device has and takes the library's for the empty ones.
func fillDates(eol, eos pgtype.Date, l apigen.CatalogLifecycle) (pgtype.Date, pgtype.Date) {
	if !eol.Valid {
		eol = catalogDate(l.EndOfSale)
	}
	if !eos.Valid {
		eos = catalogDate(l.EndOfSupport)
	}
	return eol, eos
}

func (s *Server) FillDeviceLifecycle(ctx context.Context, req apigen.FillDeviceLifecycleRequestObject) (apigen.FillDeviceLifecycleResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.FillDeviceLifecycle400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	// Rights are per device (unit grants, ADR-029): devices the caller may not edit are simply not listed.
	apply := req.Body.Apply
	out := []apigen.LifecycleFill{}
	err = s.withTx(ctx, func(q store.Querier) error {
		rows, err := q.ListDevicesMissingLifecycle(ctx, m.OrgID)
		if err != nil {
			return fmt.Errorf("devices missing lifecycle: %w", err)
		}
		for _, r := range rows {
			// A first pass on the list row; the decision is taken again on the device as loaded in this transaction.
			if eol, eos := fillDates(r.EolDate, r.EosDate, lifecycleFor(r.CatalogID, r.Model, r.PartNumber, r.Type)); eol == r.EolDate && eos == r.EosDate {
				continue
			}
			d, ok, err := loadDevice(ctx, q, m, uuid.UUID(r.ID.Bytes))
			if err != nil {
				return err
			}
			if !ok {
				continue // not visible to the caller
			}
			if level, err := deviceLevel(ctx, q, m, d); err != nil {
				return err
			} else if level < tenant.LevelEdit {
				continue
			}
			eol, eos := fillDates(d.EolDate, d.EosDate, lifecycleFor(d.CatalogID, d.Model, d.PartNumber, d.Type))
			if eol == d.EolDate && eos == d.EosDate {
				continue // someone typed the dates meanwhile
			}
			fill := apigen.LifecycleFill{Id: uuid.UUID(d.ID.Bytes), Hostname: d.Hostname, Model: d.Model}
			if eol != d.EolDate {
				fill.EolDate = apiDate(eol)
			}
			if eos != d.EosDate {
				fill.EosDate = apiDate(eos)
			}
			if !apply {
				out = append(out, fill)
				continue
			}
			next := d
			next.EolDate, next.EosDate = eol, eos
			n, err := q.UpdateDevice(ctx, store.UpdateDeviceParams{
				ID: d.ID, OrganizationID: m.OrgID, Version: d.Version, SiteID: d.SiteID,
				LocationID: d.LocationID, RackID: d.RackID, RackU: d.RackU, UHeight: d.UHeight, Hostname: d.Hostname, Type: d.Type,
				Vendor: d.Vendor, Model: d.Model, PartNumber: d.PartNumber, SerialNumber: d.SerialNumber, AssetTag: d.AssetTag,
				Firmware: d.Firmware, Role: d.Role, Lifecycle: d.Lifecycle, Managed: d.Managed, OwnerName: d.OwnerName,
				PurchaseDate: d.PurchaseDate, PoNumber: d.PoNumber, WarrantyEnd: d.WarrantyEnd, LicenseEnd: d.LicenseEnd,
				EolDate: eol, EosDate: eos, Notes: d.Notes, Tags: d.Tags, CustomFields: d.CustomFields,
				MgmtInterfaceID: d.MgmtInterfaceID, PollAddress: d.PollAddress,
				ClusterID: d.ClusterID, ClusterRole: d.ClusterRole, ClusterMemberNo: d.ClusterMemberNo,
			})
			if err != nil {
				return fmt.Errorf("fill lifecycle: %w", err)
			}
			if n == 0 {
				continue // changed by someone else since it was loaded: left for the next run
			}
			if err := audit.Write(ctx, q, audit.Entry{
				OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.update", ObjectType: "device", ObjectID: uuidStr(d.ID),
				Before: snapDevice(d), After: snapDevice(next), Meta: infoFrom(ctx).meta,
			}); err != nil {
				return err
			}
			out = append(out, fill)
		}
		if !apply {
			return errRollback
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return apigen.FillDeviceLifecycle200JSONResponse{Applied: apply, Devices: out}, nil
}
