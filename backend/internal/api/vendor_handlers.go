package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/notify"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Vendors, contacts, contracts and contract files (P2-04, ADR-044). Any member reads; editors write; every write is
// audited. Contracts cover devices and links of the same organization.

const (
	msgVendorNotFound   = "Không tìm thấy nhà cung cấp"
	msgContractNotFound = "Không tìm thấy hợp đồng"
	msgVendorWrite      = "Chỉ biên tập viên trở lên được sửa nhà cung cấp và hợp đồng"
	maxFileSize         = 10 << 20
	maxFilesPerContract = 20
)

func vendorView(v store.Vendor, contacts, contracts int64, next pgtype.Date) apigen.Vendor {
	return apigen.Vendor{Id: uuid.UUID(v.ID.Bytes), Kind: apigen.VendorKind(v.Kind), Name: v.Name, TaxCode: v.TaxCode,
		Website: v.Website, SupportPhone: v.SupportPhone, SupportEmail: v.SupportEmail, SupportPortal: v.SupportPortal,
		Notes: v.Notes, ContactCount: int(contacts), ContractCount: int(contracts), NextEnd: apiDate(next), Version: int(v.Version)}
}

func contactView(c store.VendorContact) apigen.VendorContact {
	return apigen.VendorContact{Id: uuid.UUID(c.ID.Bytes), VendorId: uuid.UUID(c.VendorID.Bytes), Name: c.Name, Title: c.Title,
		Phone: c.Phone, Email: c.Email, Notes: c.Notes, Version: int(c.Version)}
}

func contractView(k store.ListContractsRow) apigen.Contract {
	return apigen.Contract{Id: uuid.UUID(k.ID.Bytes), VendorId: uuid.UUID(k.VendorID.Bytes), VendorName: k.VendorName,
		VendorKind: apigen.VendorKind(k.VendorKind), SupportPhone: k.SupportPhone, SupportEmail: k.SupportEmail,
		SupportPortal: k.SupportPortal, Kind: apigen.ContractKind(k.Kind), Number: k.Number, Name: k.Name,
		StartDate: apiDate(k.StartDate), EndDate: apiDate(k.EndDate), Sla: k.Sla, Notes: k.Notes,
		DeviceCount: int(k.DeviceCount), LinkCount: int(k.LinkCount), FileCount: int(k.FileCount), Version: int(k.Version)}
}

// vendorFields validates a vendor body; the message is empty when it is fine.
func vendorFields(b *apigen.VendorInput) (store.CreateVendorParams, string) {
	if b == nil {
		return store.CreateVendorParams{}, "Thiếu dữ liệu"
	}
	t := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	p := store.CreateVendorParams{Kind: string(b.Kind), Name: strings.TrimSpace(b.Name), TaxCode: t(b.TaxCode), Website: t(b.Website),
		SupportPhone: t(b.SupportPhone), SupportEmail: t(b.SupportEmail), SupportPortal: t(b.SupportPortal), Notes: t(b.Notes)}
	switch {
	case !b.Kind.Valid():
		return p, "Loại nhà cung cấp không hợp lệ"
	case p.Name == "" || len(p.Name) > 200:
		return p, "Tên nhà cung cấp từ 1 đến 200 ký tự"
	case len(p.TaxCode) > 50 || len(p.SupportPhone) > 100 || len(p.Notes) > 4000:
		return p, "Có ô quá dài"
	case p.SupportEmail != "" && !notify.ValidAddress(p.SupportEmail):
		return p, "Email hỗ trợ không hợp lệ"
	case !webURL(p.Website) || !webURL(p.SupportPortal):
		return p, "Website / cổng hỗ trợ phải dạng https://…"
	}
	return p, ""
}

// webURL: empty, or an http(s) address (shown as a link: no javascript: or other schemes).
func webURL(s string) bool {
	if s == "" {
		return true
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && len(s) <= 300
}

func isUnique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func (s *Server) ListVendors(ctx context.Context, req apigen.ListVendorsRequestObject) (apigen.ListVendorsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	p := store.ListVendorsParams{OrganizationID: m.OrgID, Today: pgtype.Date{Time: calendarToday(), Valid: true}}
	if req.Params.Q != nil {
		p.Q = escapeLike(strings.TrimSpace(*req.Params.Q))
	}
	if req.Params.Kind != nil {
		p.Kind = string(*req.Params.Kind)
	}
	rows, err := s.q.ListVendors(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("list vendors: %w", err)
	}
	out := apigen.ListVendors200JSONResponse{Vendors: make([]apigen.Vendor, 0, len(rows))}
	for _, r := range rows {
		out.Vendors = append(out.Vendors, vendorView(store.Vendor{ID: r.ID, OrganizationID: r.OrganizationID, Kind: r.Kind,
			Name: r.Name, TaxCode: r.TaxCode, Website: r.Website, SupportPhone: r.SupportPhone, SupportEmail: r.SupportEmail,
			SupportPortal: r.SupportPortal, Notes: r.Notes, Version: r.Version}, r.ContactCount, r.ContractCount, r.NextEnd))
	}
	return out, nil
}

func (s *Server) CreateVendor(ctx context.Context, req apigen.CreateVendorRequestObject) (apigen.CreateVendorResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateVendor403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	p, msg := vendorFields(req.Body)
	if msg != "" {
		return apigen.CreateVendor400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	p.OrganizationID = m.OrgID
	var v store.Vendor
	dup := false
	err = s.withTx(ctx, func(q store.Querier) error {
		if v, err = q.CreateVendor(ctx, p); isUnique(err) {
			dup = true
			return errRollback
		} else if err != nil {
			return fmt.Errorf("create vendor: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor.create", ObjectType: "vendor",
			ObjectID: uuidStr(v.ID), After: v, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if dup {
		return apigen.CreateVendor409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có nhà cung cấp tên này"}}, nil
	}
	return apigen.CreateVendor201JSONResponse(vendorView(v, 0, 0, pgtype.Date{})), nil
}

func (s *Server) GetVendor(ctx context.Context, req apigen.GetVendorRequestObject) (apigen.GetVendorResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	v, err := s.q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(req.VendorId)})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.GetVendor404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVendorNotFound)}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get vendor: %w", err)
	}
	contacts, err := s.q.ListVendorContacts(ctx, store.ListVendorContactsParams{OrganizationID: m.OrgID, VendorID: v.ID})
	if err != nil {
		return nil, fmt.Errorf("vendor contacts: %w", err)
	}
	contracts, err := s.q.ListContracts(ctx, store.ListContractsParams{OrganizationID: m.OrgID, VendorID: v.ID})
	if err != nil {
		return nil, fmt.Errorf("vendor contracts: %w", err)
	}
	out := apigen.VendorDetail{Contacts: make([]apigen.VendorContact, 0, len(contacts)), Contracts: make([]apigen.Contract, 0, len(contracts))}
	var next pgtype.Date
	today := calendarToday()
	for _, c := range contacts {
		out.Contacts = append(out.Contacts, contactView(c))
	}
	for _, k := range contracts {
		out.Contracts = append(out.Contracts, contractView(k))
		if k.EndDate.Valid && !k.EndDate.Time.Before(today) && (!next.Valid || k.EndDate.Time.Before(next.Time)) {
			next = k.EndDate
		}
	}
	out.Vendor = vendorView(v, int64(len(contacts)), int64(len(contracts)), next)
	return apigen.GetVendor200JSONResponse(out), nil
}

func (s *Server) UpdateVendor(ctx context.Context, req apigen.UpdateVendorRequestObject) (apigen.UpdateVendorResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UpdateVendor403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	p, msg := vendorFields(req.Body)
	if msg == "" && req.Body.Version == nil {
		msg = "Thiếu version"
	}
	if msg != "" {
		return apigen.UpdateVendor400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var saved store.Vendor
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(req.VendorId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get vendor: %w", err)
		}
		saved, err = q.UpdateVendor(ctx, store.UpdateVendorParams{OrganizationID: m.OrgID, ID: before.ID, Version: int32(*req.Body.Version),
			Kind: p.Kind, Name: p.Name, TaxCode: p.TaxCode, Website: p.Website, SupportPhone: p.SupportPhone,
			SupportEmail: p.SupportEmail, SupportPortal: p.SupportPortal, Notes: p.Notes})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			code = 409
			return errRollback
		case isUnique(err):
			code = 4091
			return errRollback
		case err != nil:
			return fmt.Errorf("update vendor: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor.update", ObjectType: "vendor",
			ObjectID: uuidStr(saved.ID), Before: before, After: saved, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.UpdateVendor404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVendorNotFound)}, nil
	case 409:
		return apigen.UpdateVendor409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgStale}}, nil
	case 4091:
		return apigen.UpdateVendor409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Đã có nhà cung cấp tên này"}}, nil
	}
	return apigen.UpdateVendor200JSONResponse(vendorView(saved, 0, 0, pgtype.Date{})), nil
}

func (s *Server) DeleteVendor(ctx context.Context, req apigen.DeleteVendorRequestObject) (apigen.DeleteVendorResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteVendor403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		v, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(req.VendorId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get vendor: %w", err)
		}
		if n, err := q.CountLiveContractsOfVendor(ctx, store.CountLiveContractsOfVendorParams{OrganizationID: m.OrgID, VendorID: v.ID}); err != nil {
			return fmt.Errorf("count contracts: %w", err)
		} else if n > 0 {
			code = 409
			return errRollback
		}
		if _, err := q.SoftDeleteVendor(ctx, store.SoftDeleteVendorParams{OrganizationID: m.OrgID, ID: v.ID}); err != nil {
			return fmt.Errorf("delete vendor: %w", err)
		}
		if err := q.ClearDeviceSupplier(ctx, store.ClearDeviceSupplierParams{OrganizationID: m.OrgID, SupplierID: v.ID}); err != nil {
			return fmt.Errorf("clear supplier: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor.delete", ObjectType: "vendor",
			ObjectID: uuidStr(v.ID), Before: v, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.DeleteVendor404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVendorNotFound)}, nil
	case 409:
		return apigen.DeleteVendor409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Nhà cung cấp còn hợp đồng — xóa hoặc chuyển hợp đồng trước"}}, nil
	}
	return apigen.DeleteVendor204Response{}, nil
}

func contactFields(b *apigen.VendorContactInput) (store.CreateVendorContactParams, string) {
	if b == nil {
		return store.CreateVendorContactParams{}, "Thiếu dữ liệu"
	}
	t := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	p := store.CreateVendorContactParams{Name: strings.TrimSpace(b.Name), Title: t(b.Title), Phone: t(b.Phone), Email: t(b.Email), Notes: t(b.Notes)}
	switch {
	case p.Name == "" || len(p.Name) > 200:
		return p, "Tên liên hệ từ 1 đến 200 ký tự"
	case len(p.Title) > 200 || len(p.Phone) > 100 || len(p.Notes) > 2000:
		return p, "Có ô quá dài"
	case p.Email != "" && !notify.ValidAddress(p.Email):
		return p, "Email không hợp lệ"
	}
	return p, ""
}

func (s *Server) CreateVendorContact(ctx context.Context, req apigen.CreateVendorContactRequestObject) (apigen.CreateVendorContactResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateVendorContact403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	p, msg := contactFields(req.Body)
	if msg != "" {
		return apigen.CreateVendorContact400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var c store.VendorContact
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		v, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(req.VendorId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get vendor: %w", err)
		}
		p.OrganizationID, p.VendorID = m.OrgID, v.ID
		if c, err = q.CreateVendorContact(ctx, p); err != nil {
			return fmt.Errorf("create contact: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor_contact.create",
			ObjectType: "vendor_contact", ObjectID: uuidStr(c.ID), After: c, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.CreateVendorContact404JSONResponse{NotFoundJSONResponse: notFoundBody(msgVendorNotFound)}, nil
	}
	return apigen.CreateVendorContact201JSONResponse(contactView(c)), nil
}

func (s *Server) UpdateVendorContact(ctx context.Context, req apigen.UpdateVendorContactRequestObject) (apigen.UpdateVendorContactResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UpdateVendorContact403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	p, msg := contactFields(req.Body)
	if msg == "" && req.Body.Version == nil {
		msg = "Thiếu version"
	}
	if msg != "" {
		return apigen.UpdateVendorContact400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var saved store.VendorContact
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetVendorContact(ctx, store.GetVendorContactParams{OrganizationID: m.OrgID, ID: pgUUID(req.ContactId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get contact: %w", err)
		}
		saved, err = q.UpdateVendorContact(ctx, store.UpdateVendorContactParams{OrganizationID: m.OrgID, ID: before.ID,
			Version: int32(*req.Body.Version), Name: p.Name, Title: p.Title, Phone: p.Phone, Email: p.Email, Notes: p.Notes})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 409
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update contact: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor_contact.update",
			ObjectType: "vendor_contact", ObjectID: uuidStr(saved.ID), Before: before, After: saved, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.UpdateVendorContact404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy liên hệ")}, nil
	case 409:
		return apigen.UpdateVendorContact409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgStale}}, nil
	}
	return apigen.UpdateVendorContact200JSONResponse(contactView(saved)), nil
}

func (s *Server) DeleteVendorContact(ctx context.Context, req apigen.DeleteVendorContactRequestObject) (apigen.DeleteVendorContactResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteVendorContact403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		c, err := q.GetVendorContact(ctx, store.GetVendorContactParams{OrganizationID: m.OrgID, ID: pgUUID(req.ContactId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get contact: %w", err)
		}
		if _, err := q.DeleteVendorContact(ctx, store.DeleteVendorContactParams{OrganizationID: m.OrgID, ID: c.ID}); err != nil {
			return fmt.Errorf("delete contact: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "vendor_contact.delete",
			ObjectType: "vendor_contact", ObjectID: uuidStr(c.ID), Before: c, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.DeleteVendorContact404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy liên hệ")}, nil
	}
	return apigen.DeleteVendorContact204Response{}, nil
}

func (s *Server) ListContracts(ctx context.Context, req apigen.ListContractsRequestObject) (apigen.ListContractsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	p := store.ListContractsParams{OrganizationID: m.OrgID}
	if req.Params.Q != nil {
		p.Q = escapeLike(strings.TrimSpace(*req.Params.Q))
	}
	if req.Params.VendorId != nil {
		p.VendorID = pgUUID(*req.Params.VendorId)
	}
	if req.Params.DeviceId != nil {
		p.DeviceID = pgUUID(*req.Params.DeviceId)
	}
	if req.Params.LinkId != nil {
		p.LinkID = pgUUID(*req.Params.LinkId)
	}
	if d := req.Params.EndsWithinDays; d != nil {
		if *d < 0 || *d > 3650 {
			return apigen.ListContracts400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "endsWithinDays từ 0 đến 3650"}}, nil
		}
		p.EndsBefore = pgtype.Date{Time: calendarToday().AddDate(0, 0, *d+1), Valid: true}
	}
	rows, err := s.q.ListContracts(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("list contracts: %w", err)
	}
	out := apigen.ListContracts200JSONResponse{Contracts: make([]apigen.Contract, 0, len(rows))}
	for _, k := range rows {
		out.Contracts = append(out.Contracts, contractView(k))
	}
	return out, nil
}

// contractDetail is a contract with what it covers, its files and the vendor's contacts.
func contractDetail(ctx context.Context, q store.Querier, m tenant.Membership, id pgtype.UUID) (apigen.ContractDetail, bool, error) {
	k, err := q.GetContract(ctx, store.GetContractParams{OrganizationID: m.OrgID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.ContractDetail{}, false, nil
	}
	if err != nil {
		return apigen.ContractDetail{}, false, fmt.Errorf("get contract: %w", err)
	}
	rows, err := q.ListContracts(ctx, store.ListContractsParams{OrganizationID: m.OrgID, ContractID: k.ID})
	if err != nil {
		return apigen.ContractDetail{}, false, fmt.Errorf("contract row: %w", err)
	}
	if len(rows) != 1 {
		return apigen.ContractDetail{}, false, nil
	}
	out := apigen.ContractDetail{Contract: contractView(rows[0]), Devices: []apigen.ContractDevice{}, Links: []apigen.ContractLink{},
		Files: []apigen.ContractFile{}, Contacts: []apigen.VendorContact{}}
	items, err := q.ContractItems(ctx, store.ContractItemsParams{OrganizationID: m.OrgID, ContractID: k.ID})
	if err != nil {
		return out, false, fmt.Errorf("contract items: %w", err)
	}
	var devIDs, linkIDs []pgtype.UUID
	for _, it := range items {
		if it.DeviceID.Valid {
			devIDs = append(devIDs, it.DeviceID)
		} else if it.LinkID.Valid {
			linkIDs = append(linkIDs, it.LinkID)
		}
	}
	if len(devIDs) > 0 {
		devs, err := q.ListDevicesByIDs(ctx, store.ListDevicesByIDsParams{OrganizationID: m.OrgID, Ids: devIDs})
		if err != nil {
			return out, false, fmt.Errorf("contract devices: %w", err)
		}
		for _, d := range devs {
			out.Devices = append(out.Devices, apigen.ContractDevice{Id: uuid.UUID(d.ID.Bytes), Hostname: d.Hostname, SiteCode: d.SiteCode,
				Model: d.Model, Type: apigen.DeviceType(d.Type)})
		}
		slices.SortFunc(out.Devices, func(a, b apigen.ContractDevice) int {
			return strings.Compare(strings.ToLower(a.Hostname), strings.ToLower(b.Hostname))
		})
		out.HiddenDevices = len(devIDs) - len(devs)
	}
	if len(linkIDs) > 0 {
		links, err := q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, LinkIds: linkIDs})
		if err != nil {
			return out, false, fmt.Errorf("contract links: %w", err)
		}
		for _, l := range links {
			out.Links = append(out.Links, apigen.ContractLink{Id: uuid.UUID(l.ID.Bytes), AName: l.AName, BName: l.BName, Provider: l.Provider, CircuitId: l.CircuitID})
		}
	}
	files, err := q.ListContractFiles(ctx, store.ListContractFilesParams{OrganizationID: m.OrgID, ContractID: k.ID})
	if err != nil {
		return out, false, fmt.Errorf("contract files: %w", err)
	}
	for _, f := range files {
		out.Files = append(out.Files, apigen.ContractFile{Id: uuid.UUID(f.ID.Bytes), Name: f.Name, ContentType: f.ContentType, Size: int(f.Size), CreatedAt: f.CreatedAt.Time})
	}
	contacts, err := q.ListVendorContacts(ctx, store.ListVendorContactsParams{OrganizationID: m.OrgID, VendorID: k.VendorID})
	if err != nil {
		return out, false, fmt.Errorf("vendor contacts: %w", err)
	}
	for _, c := range contacts {
		out.Contacts = append(out.Contacts, contactView(c))
	}
	return out, true, nil
}

func (s *Server) GetContract(ctx context.Context, req apigen.GetContractRequestObject) (apigen.GetContractResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := contractDetail(ctx, s.q, m, pgUUID(req.ContractId))
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetContract404JSONResponse{NotFoundJSONResponse: notFoundBody(msgContractNotFound)}, nil
	}
	return apigen.GetContract200JSONResponse(d), nil
}

// contractInput is a validated contract body.
type contractInput struct {
	vendor             pgtype.UUID
	kind, number, name string
	start, end         pgtype.Date
	sla, notes         string
	devices, links     []pgtype.UUID
	deviceIDs, linkIDs []uuid.UUID
	version            int32
}

func contractFields(b *apigen.ContractInput) (contractInput, string) {
	if b == nil {
		return contractInput{}, "Thiếu dữ liệu"
	}
	t := func(p *string) string {
		if p == nil {
			return ""
		}
		return strings.TrimSpace(*p)
	}
	c := contractInput{vendor: pgUUID(b.VendorId), kind: string(b.Kind), number: t(b.Number), name: strings.TrimSpace(b.Name),
		start: pgDate(b.StartDate), end: pgDate(b.EndDate), sla: t(b.Sla), notes: t(b.Notes)}
	if b.Version != nil {
		c.version = int32(*b.Version)
	}
	switch {
	case !b.Kind.Valid():
		return c, "Loại hợp đồng không hợp lệ"
	case c.name == "" || len(c.name) > 200:
		return c, "Tên hợp đồng từ 1 đến 200 ký tự"
	case len(c.number) > 100 || len(c.sla) > 500 || len(c.notes) > 4000:
		return c, "Có ô quá dài"
	case c.start.Valid && c.end.Valid && c.end.Time.Before(c.start.Time):
		return c, "Ngày kết thúc phải sau ngày bắt đầu"
	case len(b.DeviceIds) > 1000 || len(b.LinkIds) > 1000:
		return c, "Tối đa 1000 thiết bị và 1000 link mỗi hợp đồng"
	}
	c.deviceIDs, c.linkIDs = uniqueIDs(b.DeviceIds), uniqueIDs(b.LinkIds)
	for _, id := range c.deviceIDs {
		c.devices = append(c.devices, pgUUID(id))
	}
	for _, id := range c.linkIDs {
		c.links = append(c.links, pgUUID(id))
	}
	return c, ""
}

// setContractItems replaces what a contract covers; every device / link must be of the organization.
func setContractItems(ctx context.Context, q store.Querier, m tenant.Membership, contract pgtype.UUID, c contractInput) (string, error) {
	if len(c.devices) > 0 {
		devs, err := q.ListDevicesByIDs(ctx, store.ListDevicesByIDsParams{OrganizationID: m.OrgID, Ids: c.devices})
		if err != nil {
			return "", fmt.Errorf("check devices: %w", err)
		}
		if len(devs) != len(c.devices) {
			return "Có thiết bị không thuộc tổ chức này", nil
		}
	}
	if len(c.links) > 0 {
		n, err := q.CountLinksInOrg(ctx, store.CountLinksInOrgParams{OrganizationID: m.OrgID, Ids: c.links})
		if err != nil {
			return "", fmt.Errorf("check links: %w", err)
		}
		if int(n) != len(c.links) {
			return "Có link không thuộc tổ chức này", nil
		}
	}
	if err := q.DeleteContractItems(ctx, store.DeleteContractItemsParams{OrganizationID: m.OrgID, ContractID: contract}); err != nil {
		return "", fmt.Errorf("clear items: %w", err)
	}
	if len(c.devices) > 0 {
		if err := q.AddContractDevices(ctx, store.AddContractDevicesParams{OrganizationID: m.OrgID, ContractID: contract, DeviceIds: c.devices}); err != nil {
			return "", fmt.Errorf("add devices: %w", err)
		}
	}
	if len(c.links) > 0 {
		if err := q.AddContractLinks(ctx, store.AddContractLinksParams{OrganizationID: m.OrgID, ContractID: contract, LinkIds: c.links}); err != nil {
			return "", fmt.Errorf("add links: %w", err)
		}
	}
	return "", nil
}

// contractAudit is what the audit log keeps of a contract and its coverage.
func contractAudit(k store.Contract, devices, links []uuid.UUID) map[string]any {
	return map[string]any{"vendorId": uuidStr(k.VendorID), "kind": k.Kind, "number": k.Number, "name": k.Name,
		"startDate": dateStr(k.StartDate), "endDate": dateStr(k.EndDate), "sla": k.Sla, "notes": k.Notes,
		"deviceIds": devices, "linkIds": links}
}

func itemIDs(items []store.ContractItemsRow) (devices, links []uuid.UUID) {
	devices, links = []uuid.UUID{}, []uuid.UUID{}
	for _, it := range items {
		if it.DeviceID.Valid {
			devices = append(devices, uuid.UUID(it.DeviceID.Bytes))
		} else if it.LinkID.Valid {
			links = append(links, uuid.UUID(it.LinkID.Bytes))
		}
	}
	return devices, links
}

func (s *Server) CreateContract(ctx context.Context, req apigen.CreateContractRequestObject) (apigen.CreateContractResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateContract403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	c, msg := contractFields(req.Body)
	if msg != "" {
		return apigen.CreateContract400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var detail apigen.ContractDetail
	err = s.withTx(ctx, func(q store.Querier) error {
		if _, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: c.vendor}); errors.Is(err, pgx.ErrNoRows) {
			msg = "Chọn một nhà cung cấp của tổ chức này"
			return errRollback
		} else if err != nil {
			return fmt.Errorf("get vendor: %w", err)
		}
		k, err := q.CreateContract(ctx, store.CreateContractParams{OrganizationID: m.OrgID, VendorID: c.vendor, Kind: c.kind,
			Number: c.number, Name: c.name, StartDate: c.start, EndDate: c.end, Sla: c.sla, Notes: c.notes})
		if err != nil {
			return fmt.Errorf("create contract: %w", err)
		}
		if msg, err = setContractItems(ctx, q, m, k.ID, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "contract.create", ObjectType: "contract",
			ObjectID: uuidStr(k.ID), After: contractAudit(k, c.deviceIDs, c.linkIDs), Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		var ok bool
		detail, ok, err = contractDetail(ctx, q, m, k.ID)
		if err == nil && !ok {
			err = errors.New("contract vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return apigen.CreateContract400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.CreateContract201JSONResponse(detail), nil
}

func (s *Server) UpdateContract(ctx context.Context, req apigen.UpdateContractRequestObject) (apigen.UpdateContractResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UpdateContract403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	c, msg := contractFields(req.Body)
	if msg == "" && req.Body.Version == nil {
		msg = "Thiếu version"
	}
	if msg != "" {
		return apigen.UpdateContract400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var detail apigen.ContractDetail
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetContract(ctx, store.GetContractParams{OrganizationID: m.OrgID, ID: pgUUID(req.ContractId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get contract: %w", err)
		}
		if _, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: c.vendor}); errors.Is(err, pgx.ErrNoRows) {
			msg = "Chọn một nhà cung cấp của tổ chức này"
			return errRollback
		} else if err != nil {
			return fmt.Errorf("get vendor: %w", err)
		}
		oldItems, err := q.ContractItems(ctx, store.ContractItemsParams{OrganizationID: m.OrgID, ContractID: before.ID})
		if err != nil {
			return fmt.Errorf("contract items: %w", err)
		}
		k, err := q.UpdateContract(ctx, store.UpdateContractParams{OrganizationID: m.OrgID, ID: before.ID, Version: c.version,
			VendorID: c.vendor, Kind: c.kind, Number: c.number, Name: c.name, StartDate: c.start, EndDate: c.end, Sla: c.sla, Notes: c.notes})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 409
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update contract: %w", err)
		}
		if msg, err = setContractItems(ctx, q, m, k.ID, c); err != nil || msg != "" {
			if err == nil {
				err = errRollback
			}
			return err
		}
		od, ol := itemIDs(oldItems)
		if err := audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "contract.update", ObjectType: "contract",
			ObjectID: uuidStr(k.ID), Before: contractAudit(before, od, ol), After: contractAudit(k, c.deviceIDs, c.linkIDs),
			Meta: infoFrom(ctx).meta}); err != nil {
			return err
		}
		var ok bool
		detail, ok, err = contractDetail(ctx, q, m, k.ID)
		if err == nil && !ok {
			err = errors.New("contract vanished")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	switch {
	case code == 404:
		return apigen.UpdateContract404JSONResponse{NotFoundJSONResponse: notFoundBody(msgContractNotFound)}, nil
	case code == 409:
		return apigen.UpdateContract409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgStale}}, nil
	case msg != "":
		return apigen.UpdateContract400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	return apigen.UpdateContract200JSONResponse(detail), nil
}

func (s *Server) DeleteContract(ctx context.Context, req apigen.DeleteContractRequestObject) (apigen.DeleteContractResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteContract403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		k, err := q.GetContract(ctx, store.GetContractParams{OrganizationID: m.OrgID, ID: pgUUID(req.ContractId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get contract: %w", err)
		}
		items, err := q.ContractItems(ctx, store.ContractItemsParams{OrganizationID: m.OrgID, ContractID: k.ID})
		if err != nil {
			return fmt.Errorf("contract items: %w", err)
		}
		if _, err := q.SoftDeleteContract(ctx, store.SoftDeleteContractParams{OrganizationID: m.OrgID, ID: k.ID}); err != nil {
			return fmt.Errorf("delete contract: %w", err)
		}
		// Its files go now: nobody could reach them once the contract is gone.
		gone, err := q.DeleteContractFiles(ctx, store.DeleteContractFilesParams{OrganizationID: m.OrgID, ContractID: k.ID})
		if err != nil {
			return fmt.Errorf("delete contract files: %w", err)
		}
		d, l := itemIDs(items)
		before := contractAudit(k, d, l)
		names := make([]string, 0, len(gone))
		for _, f := range gone {
			names = append(names, f.Name)
		}
		before["files"] = names
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "contract.delete", ObjectType: "contract",
			ObjectID: uuidStr(k.ID), Before: before, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.DeleteContract404JSONResponse{NotFoundJSONResponse: notFoundBody(msgContractNotFound)}, nil
	}
	return apigen.DeleteContract204Response{}, nil
}

// allowedFiles: what may be attached, by extension, with the sniffed types each may show (Office files are zip or
// OLE containers). The stored type comes from this table, never from the client.
var allowedFiles = map[string]struct {
	ctype string
	sniff []string
}{
	".pdf":  {"application/pdf", []string{"application/pdf"}},
	".png":  {"image/png", []string{"image/png"}},
	".jpg":  {"image/jpeg", []string{"image/jpeg"}},
	".jpeg": {"image/jpeg", []string{"image/jpeg"}},
	".webp": {"image/webp", []string{"image/webp"}},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", []string{"application/zip"}},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []string{"application/zip"}},
	".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", []string{"application/zip"}},
	".doc":  {"application/msword", nil},
	".xls":  {"application/vnd.ms-excel", nil},
	".txt":  {"text/plain", []string{"text/plain; charset=utf-8"}},
	".csv":  {"text/csv", []string{"text/plain; charset=utf-8"}},
}

// cleanFileName keeps the base name, without path parts or control characters, at most 255 bytes.
func cleanFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if len(name) > 1024 {
		name = name[len(name)-1024:] // keep the end (the extension); a huge header must not cost much
	}
	name = strings.Map(func(r rune) rune {
		// Control characters and bidi overrides (a name could pretend "fdp.exe" is "exe.pdf").
		if r < 0x20 || r == 0x7f || (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	for len(name) > 255 {
		_, n := utf8.DecodeRuneInString(name)
		name = name[n:] // drop from the front: the extension stays
	}
	if name == "." || name == "/" {
		return ""
	}
	return name
}

func (s *Server) UploadContractFile(ctx context.Context, req apigen.UploadContractFileRequestObject) (apigen.UploadContractFileResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.UploadContractFile403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	bad := func(msg string) (apigen.UploadContractFileResponseObject, error) {
		return apigen.UploadContractFile400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	if req.Body == nil {
		return bad("Thiếu file")
	}
	var name string
	var data []byte
	for {
		part, err := req.Body.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return bad("Dữ liệu tải lên không hợp lệ")
		}
		if part.FormName() != "file" || data != nil {
			_ = part.Close()
			continue
		}
		name = cleanFileName(part.FileName())
		data, err = io.ReadAll(io.LimitReader(part, maxFileSize+1))
		_ = part.Close()
		if err != nil {
			return bad("Không đọc được file")
		}
	}
	switch {
	case data == nil || name == "":
		return bad("Thiếu file")
	case len(data) == 0:
		return bad("File rỗng")
	case len(data) > maxFileSize:
		return apigen.UploadContractFile413JSONResponse{Message: "File tối đa 10 MB"}, nil
	}
	kind, ok := allowedFiles[strings.ToLower(filepath.Ext(name))]
	if !ok {
		return bad("Chỉ nhận PDF, ảnh (PNG, JPG, WEBP), Word, Excel, PowerPoint, TXT, CSV")
	}
	// Legacy Word / Excel are OLE compound files (D0 CF 11 E0 …); everything else is recognised by its content.
	ole := bytes.HasPrefix(data, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1})
	legacy := kind.ctype == "application/msword" || kind.ctype == "application/vnd.ms-excel"
	if (legacy && !ole) || (!legacy && !slices.Contains(kind.sniff, http.DetectContentType(data))) {
		return bad("Nội dung file không khớp với phần mở rộng")
	}
	sum := sha256.Sum256(data)
	var created store.CreateFileRow
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		// Locked: two uploads at once must not pass the per-contract limit together.
		kid, err := q.LockContract(ctx, store.LockContractParams{OrganizationID: m.OrgID, ID: pgUUID(req.ContractId)})
		if errors.Is(err, pgx.ErrNoRows) {
			code = 404
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("lock contract: %w", err)
		}
		k := store.Contract{ID: kid}
		if n, err := q.CountContractFiles(ctx, store.CountContractFilesParams{OrganizationID: m.OrgID, ContractID: k.ID}); err != nil {
			return fmt.Errorf("count files: %w", err)
		} else if n >= maxFilesPerContract {
			code = 400
			return errRollback
		}
		if created, err = q.CreateFile(ctx, store.CreateFileParams{OrganizationID: m.OrgID, ContractID: k.ID, Name: name,
			ContentType: kind.ctype, Size: int32(len(data)), Sha256: sum[:], Data: data, CreatedBy: m.UserID}); err != nil {
			return fmt.Errorf("create file: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "file.upload", ObjectType: "contract",
			ObjectID: uuidStr(k.ID), After: map[string]any{"fileId": uuidStr(created.ID), "name": name, "size": len(data),
				"sha256": fmt.Sprintf("%x", sum)}, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.UploadContractFile404JSONResponse{NotFoundJSONResponse: notFoundBody(msgContractNotFound)}, nil
	case 400:
		return bad(fmt.Sprintf("Tối đa %d file mỗi hợp đồng", maxFilesPerContract))
	}
	return apigen.UploadContractFile201JSONResponse{Id: uuid.UUID(created.ID.Bytes), Name: created.Name, ContentType: created.ContentType,
		Size: int(created.Size), CreatedAt: created.CreatedAt.Time}, nil
}

func (s *Server) DownloadFile(ctx context.Context, req apigen.DownloadFileRequestObject) (apigen.DownloadFileResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	f, err := s.q.GetFile(ctx, store.GetFileParams{OrganizationID: m.OrgID, ID: pgUUID(req.FileId)})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.DownloadFile404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy file")}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get file: %w", err)
	}
	// Always a download (never rendered in the app's origin), the name RFC 6266 / 5987 encoded.
	disp := mime.FormatMediaType("attachment", map[string]string{"filename": f.Name})
	if disp == "" {
		disp = "attachment"
	}
	nosniff, cache := "nosniff", "private, no-store"
	return apigen.DownloadFile200ApplicationoctetStreamResponse{Body: bytes.NewReader(f.Data), ContentLength: int64(len(f.Data)),
		Headers: apigen.DownloadFile200ResponseHeaders{ContentDisposition: &disp, XContentTypeOptions: &nosniff, CacheControl: &cache}}, nil
}

func (s *Server) DeleteFile(ctx context.Context, req apigen.DeleteFileRequestObject) (apigen.DeleteFileResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.DeleteFile403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgVendorWrite}}, nil
	}
	missing := false
	err = s.withTx(ctx, func(q store.Querier) error {
		f, err := q.GetFileMeta(ctx, store.GetFileMetaParams{OrganizationID: m.OrgID, ID: pgUUID(req.FileId)})
		if errors.Is(err, pgx.ErrNoRows) {
			missing = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("get file: %w", err)
		}
		if _, err := q.DeleteFile(ctx, store.DeleteFileParams{OrganizationID: m.OrgID, ID: f.ID}); err != nil {
			return fmt.Errorf("delete file: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "file.delete", ObjectType: "contract",
			ObjectID: uuidStr(f.ContractID), Before: map[string]any{"fileId": uuidStr(f.ID), "name": f.Name, "size": f.Size}, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	if missing {
		return apigen.DeleteFile404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy file")}, nil
	}
	return apigen.DeleteFile204Response{}, nil
}

func (s *Server) SetDeviceSupplier(ctx context.Context, req apigen.SetDeviceSupplierRequestObject) (apigen.SetDeviceSupplierResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.SetDeviceSupplier400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		d, ok, err := loadDevice(ctx, q, m, req.DeviceId)
		if err != nil {
			return err
		}
		if !ok {
			code = 404
			return errRollback
		}
		if level, err := deviceLevel(ctx, q, m, d); err != nil {
			return err
		} else if level < tenant.LevelEdit {
			code = 403
			return errRollback
		}
		var supplier pgtype.UUID
		if req.Body.SupplierId != nil {
			v, err := q.GetVendor(ctx, store.GetVendorParams{OrganizationID: m.OrgID, ID: pgUUID(*req.Body.SupplierId)})
			if errors.Is(err, pgx.ErrNoRows) {
				code = 400
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("get vendor: %w", err)
			}
			supplier = v.ID
		}
		if supplier == d.SupplierID {
			return nil
		}
		if _, err := q.SetDeviceSupplier(ctx, store.SetDeviceSupplierParams{OrganizationID: m.OrgID, ID: d.ID, SupplierID: supplier}); err != nil {
			return fmt.Errorf("set supplier: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.supplier", ObjectType: "device",
			ObjectID: uuidStr(d.ID), Before: map[string]any{"supplierId": uuidStr(d.SupplierID)},
			After: map[string]any{"supplierId": uuidStr(supplier)}, Meta: infoFrom(ctx).meta})
	})
	if err != nil {
		return nil, err
	}
	switch code {
	case 404:
		return apigen.SetDeviceSupplier404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case 403:
		return apigen.SetDeviceSupplier403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case 400:
		return apigen.SetDeviceSupplier400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Chọn một nhà cung cấp của tổ chức này"}}, nil
	}
	return apigen.SetDeviceSupplier204Response{}, nil
}
