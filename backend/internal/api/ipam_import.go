package api

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// IPAM import (P2-09, SRS §12): rows of an IP plan spreadsheet, each with any of a VLAN, a subnet and a range. What
// exists is completed, never duplicated (VLAN by site + id, subnet by VRF + CIDR, range by its bounds); every write
// goes through the same checks and audit as the forms. A bad row is rolled back alone (savepoint) and reported.

const maxIpamImportRows = 5000

// rangeKindWords maps what spreadsheets write to the range kinds.
var rangeKindWords = map[string]string{
	"dhcp": "dhcp", "pool": "dhcp", "động": "dhcp", "dong": "dhcp", "cấp phát động": "dhcp", "dhcp pool": "dhcp",
	"static": "static", "tĩnh": "static", "tinh": "static", "cố định": "static", "co dinh": "static", "ip tĩnh": "static",
	"reserved": "reserved", "dành riêng": "reserved", "danh rieng": "reserved", "dự phòng": "reserved", "du phong": "reserved",
	"reserve": "reserved", "giữ chỗ": "reserved",
}

type ipamImportRun struct {
	ctx   context.Context
	m     tenant.Membership
	sites map[string]uuid.UUID
	// What the current row did; added to the totals only when the row stands (a bad row is rolled back).
	rowCreated, rowUpdated apigen.IpamImportCounts
	created, updated       apigen.IpamImportCounts
}

func (s *Server) ImportIpam(ctx context.Context, req apigen.ImportIpamRequestObject) (apigen.ImportIpamResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.ImportIpam403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: "Chỉ owner, admin hoặc editor được nhập IPAM"}}, nil
	}
	if req.Body == nil || len(req.Body.Rows) == 0 || len(req.Body.Rows) > maxIpamImportRows {
		return apigen.ImportIpam400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{
			Message: fmt.Sprintf("File cần từ 1 đến %d dòng", maxIpamImportRows)}}, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin import: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run := &ipamImportRun{ctx: ctx, m: m, sites: map[string]uuid.UUID{}}
	sites, err := store.New(tx).ImportSites(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("import sites: %w", err)
	}
	// Full code, own code (when unique) and name, all case-insensitive.
	own := map[string]int{}
	for _, st := range sites {
		own[strings.ToLower(st.LocalCode)]++
	}
	for _, st := range sites {
		id := uuid.UUID(st.ID.Bytes)
		run.sites[strings.ToLower(st.Code)] = id
		if own[strings.ToLower(st.LocalCode)] == 1 {
			if _, taken := run.sites[strings.ToLower(st.LocalCode)]; !taken {
				run.sites[strings.ToLower(st.LocalCode)] = id
			}
		}
		if _, taken := run.sites[strings.ToLower(st.Name)]; !taken {
			run.sites[strings.ToLower(st.Name)] = id
		}
	}
	out := apigen.IpamImportResult{Rows: make([]apigen.IpamImportRowResult, 0, len(req.Body.Rows))}
	for i, row := range req.Body.Rows {
		sp, err := tx.Begin(ctx) // savepoint: a bad row goes back alone
		if err != nil {
			return nil, fmt.Errorf("savepoint: %w", err)
		}
		run.rowCreated, run.rowUpdated = apigen.IpamImportCounts{}, apigen.IpamImportCounts{}
		res, err := run.row(store.New(sp), row)
		if err != nil {
			return nil, err
		}
		res.Row = i
		if res.Status == apigen.IpamImportRowResultStatusError {
			out.Errors++
			if err := sp.Rollback(ctx); err != nil {
				return nil, fmt.Errorf("rollback row: %w", err)
			}
		} else {
			if err := sp.Commit(ctx); err != nil {
				return nil, fmt.Errorf("release row: %w", err)
			}
			run.created.Vlans += run.rowCreated.Vlans
			run.created.Subnets += run.rowCreated.Subnets
			run.created.Ranges += run.rowCreated.Ranges
			run.updated.Subnets += run.rowUpdated.Subnets
		}
		out.Rows = append(out.Rows, res)
	}
	out.Created, out.Updated = run.created, run.updated
	if !req.Body.DryRun {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit import: %w", err)
		}
	}
	return apigen.ImportIpam200JSONResponse(out), nil
}

// failed reports a refusal of a write helper as the row's message.
func failed(out writeOutcome) string {
	switch {
	case out.bad != "":
		return out.bad
	case out.conf != "":
		return out.conf
	case out.code == 403:
		return "Bạn không có quyền sửa ở site này"
	default:
		return "Không tìm thấy đối tượng"
	}
}

// row imports one spreadsheet row; a refusal comes back as status error (the caller rolls the row back).
func (r *ipamImportRun) row(q store.Querier, in apigen.IpamImportRow) (apigen.IpamImportRowResult, error) {
	res := apigen.IpamImportRowResult{Actions: []string{}}
	bad := func(msg string) (apigen.IpamImportRowResult, error) {
		res.Status, res.Message = apigen.IpamImportRowResultStatusError, msg
		return res, nil
	}
	created, updated := false, false
	var site *uuid.UUID
	if name := strings.TrimSpace(str(in.Site)); name != "" {
		id, ok := r.sites[strings.ToLower(name)]
		if !ok {
			return bad(fmt.Sprintf("Không có site %q (dùng mã site hoặc tên site)", name))
		}
		site = &id
	}
	cidr := strings.TrimSpace(str(in.Cidr))
	start, end := strings.TrimSpace(str(in.RangeStart)), strings.TrimSpace(str(in.RangeEnd))
	if in.Vlan == nil && cidr == "" && start == "" && end == "" {
		return bad("Dòng không có VLAN, subnet hay dải IP")
	}

	// VLAN: the site's own, else the organization-wide one; created at the row's scope when missing.
	var vlan *uuid.UUID
	if in.Vlan != nil {
		id, err := r.findVlan(q, *in.Vlan, site)
		if err != nil {
			return res, err
		}
		if id == nil {
			name := strings.TrimSpace(str(in.VlanName))
			if name == "" {
				name = fmt.Sprintf("VLAN %d", *in.Vlan)
			}
			f, msg := validateVlan(*in.Vlan, name, nil, nil, site)
			if msg != "" {
				return bad(msg)
			}
			var out writeOutcome
			v, err := writeVlan(r.ctx, q, r.m, f, nil, 0, &out)
			if errors.Is(err, errRollback) {
				return bad(failed(out))
			} else if err != nil {
				return res, err
			}
			u := uuid.UUID(v.ID.Bytes)
			id = &u
			created = true
			r.rowCreated.Vlans++
			res.Actions = append(res.Actions, fmt.Sprintf("Tạo VLAN %d %s", *in.Vlan, name))
		}
		vlan = id
	}

	// Subnet: created, or completed with what the row gives (never cleared).
	var subnet *uuid.UUID
	if cidr != "" {
		vrf := strings.TrimSpace(str(in.Vrf))
		f, msg := validateSubnet(cidr, &vrf, in.Gateway, in.Description, site, vlan)
		if msg != "" {
			return bad(msg)
		}
		existing, err := q.FindSubnetID(r.ctx, store.FindSubnetIDParams{OrganizationID: r.m.OrgID, Vrf: f.vrf, Cidr: f.cidr})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			var out writeOutcome
			sn, err := writeSubnet(r.ctx, q, r.m, f, nil, 0, &out)
			if errors.Is(err, errRollback) {
				return bad(failed(out))
			} else if err != nil {
				return res, err
			}
			u := uuid.UUID(sn.ID.Bytes)
			subnet = &u
			created = true
			r.rowCreated.Subnets++
			res.Actions = append(res.Actions, "Tạo subnet "+f.cidr.String())
		case err != nil:
			return res, fmt.Errorf("find subnet: %w", err)
		default:
			u := uuid.UUID(existing.Bytes)
			subnet = &u
			changed, kept, err := r.completeSubnet(q, u, f, in)
			if err != nil {
				return res, err
			}
			for _, k := range kept {
				res.Actions = append(res.Actions, "Khác IPAM, "+k)
			}
			if changed != "" {
				if strings.HasPrefix(changed, "!") {
					return bad(changed[1:])
				}
				updated = true
				r.rowUpdated.Subnets++
				res.Actions = append(res.Actions, changed)
			}
		}
	}

	// Range: added unless the same bounds are there already.
	if start != "" || end != "" {
		if start == "" || end == "" {
			return bad("Dải IP cần cả địa chỉ đầu và địa chỉ cuối")
		}
		if subnet == nil {
			// No subnet column: the most specific subnet of the VRF holding both ends.
			a, err1 := netip.ParseAddr(start)
			b, err2 := netip.ParseAddr(end)
			if err1 != nil || err2 != nil {
				return bad("Địa chỉ đầu/cuối là địa chỉ IP, vd 10.72.114.100")
			}
			id, err := q.SubnetHolding(r.ctx, store.SubnetHoldingParams{OrganizationID: r.m.OrgID, Vrf: strings.TrimSpace(str(in.Vrf)),
				FirstIp: a.Unmap(), LastIp: b.Unmap()})
			if errors.Is(err, pgx.ErrNoRows) {
				return bad(fmt.Sprintf("Không có subnet nào chứa dải %s–%s (thêm cột Subnet)", start, end))
			} else if err != nil {
				return res, fmt.Errorf("subnet of range: %w", err)
			}
			u := uuid.UUID(id.Bytes)
			subnet = &u
		}
		kind, ok := rangeKindWords[strings.ToLower(strings.TrimSpace(str(in.RangeKind)))]
		if !ok {
			return bad("Loại dải: dhcp, static hoặc reserved")
		}
		sameKind, err := r.sameRange(q, *subnet, start, end)
		if err != nil {
			return res, err
		}
		if sameKind != "" && sameKind != kind {
			res.Actions = append(res.Actions, fmt.Sprintf("Khác IPAM, giữ dải %s–%s loại %s (file ghi %s)", start, end, sameKind, kind))
		}
		if sameKind == "" {
			var out writeOutcome
			if _, _, err := writeRange(r.ctx, q, r.m, *subnet, start, end, apigen.IpRangeKind(kind), in.Purpose, &out); errors.Is(err, errRollback) {
				return bad(failed(out))
			} else if err != nil {
				return res, err
			}
			created = true
			r.rowCreated.Ranges++
			res.Actions = append(res.Actions, fmt.Sprintf("Thêm dải %s %s–%s", kind, start, end))
		}
	}
	switch {
	case created:
		res.Status = apigen.IpamImportRowResultStatusCreated
	case updated:
		res.Status = apigen.IpamImportRowResultStatusUpdated
	default:
		res.Status = apigen.IpamImportRowResultStatusUnchanged
	}
	return res, nil
}

func (r *ipamImportRun) findVlan(q store.Querier, vid int32, site *uuid.UUID) (*uuid.UUID, error) {
	try := func(scope pgtype.UUID) (*uuid.UUID, error) {
		id, err := q.FindVlanID(r.ctx, store.FindVlanIDParams{OrganizationID: r.m.OrgID, Vid: vid, SiteID: scope})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("find vlan: %w", err)
		}
		u := uuid.UUID(id.Bytes)
		return &u, nil
	}
	if site != nil {
		if id, err := try(pgUUID(*site)); err != nil || id != nil {
			return id, err
		}
	}
	return try(pgtype.UUID{})
}

// completeSubnet fills in what the subnet is missing and the row gives; what the row gives differently is kept as it
// is in IPAM and reported (spreadsheets are often older than IPAM). Returns the change ("" = none, "!msg" = refused)
// and the differences left alone.
func (r *ipamImportRun) completeSubnet(q store.Querier, id uuid.UUID, f subnetFields, in apigen.IpamImportRow) (string, []string, error) {
	before, ok, err := loadSubnet(r.ctx, q, r.m, id)
	if err != nil || !ok {
		if err == nil {
			return "!Không tìm thấy subnet", nil, nil
		}
		return "", nil, err
	}
	next := subnetFields{cidr: before.Cidr, vrf: before.Vrf, gateway: before.Gateway, description: before.Description}
	if before.SiteID.Valid {
		u := uuid.UUID(before.SiteID.Bytes)
		next.site = &u
	}
	if before.VlanID.Valid {
		u := uuid.UUID(before.VlanID.Bytes)
		next.vlan = &u
	}
	what, kept := []string{}, []string{}
	switch {
	case f.gateway == nil:
	case before.Gateway == nil:
		next.gateway, what = f.gateway, append(what, "gateway")
	case *before.Gateway != *f.gateway:
		kept = append(kept, fmt.Sprintf("giữ gateway %s (file ghi %s)", before.Gateway, f.gateway))
	}
	if d := strings.TrimSpace(str(in.Description)); d != "" {
		if before.Description == "" {
			next.description, what = f.description, append(what, "mô tả")
		} else if f.description != before.Description {
			kept = append(kept, "giữ mô tả đang có")
		}
	}
	switch {
	case f.vlan == nil:
	case next.vlan == nil:
		next.vlan, what = f.vlan, append(what, "VLAN")
	case *next.vlan != *f.vlan:
		kept = append(kept, fmt.Sprintf("giữ VLAN %d (file ghi khác)", before.VlanVid.Int32))
	}
	switch {
	case f.site == nil:
	case next.site == nil:
		next.site, what = f.site, append(what, "site")
	case *next.site != *f.site:
		kept = append(kept, fmt.Sprintf("giữ site %s (file ghi khác)", before.SiteCode))
	}
	if len(what) == 0 {
		return "", kept, nil
	}
	var out writeOutcome
	if _, err := writeSubnet(r.ctx, q, r.m, next, &id, before.Version, &out); errors.Is(err, errRollback) {
		return "!" + failed(out), nil, nil
	} else if err != nil {
		return "", nil, err
	}
	return fmt.Sprintf("Bổ sung %s cho %s", strings.Join(what, ", "), before.Cidr), kept, nil
}

// sameRange returns the kind of the subnet's range with exactly these bounds ("" = none).
func (r *ipamImportRun) sameRange(q store.Querier, subnet uuid.UUID, start, end string) (string, error) {
	a, err1 := netip.ParseAddr(start)
	b, err2 := netip.ParseAddr(end)
	if err1 != nil || err2 != nil {
		return "", nil // writeRange explains
	}
	ranges, err := q.ListRanges(r.ctx, store.ListRangesParams{OrganizationID: r.m.OrgID, SubnetID: pgUUID(subnet)})
	if err != nil {
		return "", fmt.Errorf("list ranges: %w", err)
	}
	for _, rg := range ranges {
		if rg.StartIp == a.Unmap() && rg.EndIp == b.Unmap() {
			return rg.Kind, nil
		}
	}
	return "", nil
}
