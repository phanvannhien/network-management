package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/catalog"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Devices (P1-08, SRS §4.1). A device sits in one site; its category is the site's (ADR-032). Every member of the
// organization sees every device; editors change them.

const (
	msgDeviceNotFound  = "Không tìm thấy thiết bị"
	msgDeviceDuplicate = "Hostname đã tồn tại trong tổ chức (chỉ thành viên cùng một cụm được trùng hostname)"
	devicePageDefault  = 50
	devicePageMax      = 200
)

var (
	hostnameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
	isoDateRe  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// deviceFields is the validated, normalized body of a create / update.
type deviceFields struct {
	hostname, typ, vendor, model, partNumber, serial, assetTag, firmware, role, lifecycle, owner, po, notes string
	managed                                                                                                 bool
	purchase, warranty, license, eol, eos                                                                   pgtype.Date
	tags                                                                                                    []string
	custom                                                                                                  map[string]any
	site                                                                                                    uuid.UUID
	location, rack                                                                                          *uuid.UUID
	rackU                                                                                                   pgtype.Int4
	uHeight                                                                                                 int32
	uHeightSet                                                                                              bool
	mgmt, template                                                                                          *uuid.UUID
	catalog                                                                                                 string
	poll                                                                                                    *netip.Addr
	cluster                                                                                                 *uuid.UUID
	clusterRole                                                                                             pgtype.Text
	clusterNo                                                                                               pgtype.Int4
}

func pgDate(d *openapi_types.Date) pgtype.Date {
	if d == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: d.Time, Valid: true}
}

func apiDate(d pgtype.Date) *openapi_types.Date {
	if !d.Valid {
		return nil
	}
	return &openapi_types.Date{Time: d.Time}
}

// normalizeTags trims, drops empties and case-insensitive duplicates (first spelling wins).
func normalizeTags(in []string) ([]string, string) {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if tooLong(t, 50) || strings.ContainsAny(t, ",;") {
			return nil, "Tag tối đa 50 ký tự, không chứa dấu phẩy/chấm phẩy"
		}
		if k := strings.ToLower(t); !seen[k] {
			seen[k] = true
			out = append(out, t)
		}
	}
	if len(out) > 50 {
		return nil, "Tối đa 50 tag"
	}
	return out, ""
}

// deviceBody is the subset of DeviceInput / DeviceUpdate both handlers read.
type deviceBody struct {
	Hostname                                                                                string
	Type                                                                                    apigen.DeviceType
	Vendor, Model, PartNumber, SerialNumber, AssetTag, Firmware, OwnerName, PoNumber, Notes *string
	Role                                                                                    *apigen.DeviceRole
	Lifecycle                                                                               *apigen.DeviceLifecycle
	Managed                                                                                 *bool
	PurchaseDate, WarrantyEnd, LicenseEnd, EolDate, EosDate                                 *openapi_types.Date
	Tags                                                                                    *[]string
	CustomFields                                                                            *map[string]interface{}
	SiteId                                                                                  uuid.UUID
	LocationId, RackId                                                                      *uuid.UUID
	RackU, UHeight                                                                          *int32
	MgmtInterfaceId, TemplateId                                                             *uuid.UUID
	CatalogId                                                                               *string
	PollAddress                                                                             *string
	ClusterId                                                                               *uuid.UUID
	ClusterRole                                                                             *apigen.ClusterRole
	ClusterMemberNo                                                                         *int32
}

func validateDevice(b deviceBody) (deviceFields, string) {
	f := deviceFields{
		hostname: strings.TrimSpace(b.Hostname), typ: string(b.Type), vendor: str(b.Vendor), model: str(b.Model),
		partNumber: str(b.PartNumber), serial: str(b.SerialNumber), assetTag: str(b.AssetTag), firmware: str(b.Firmware),
		owner: str(b.OwnerName), po: str(b.PoNumber), notes: str(b.Notes), role: "none", lifecycle: "active", managed: true,
		purchase: pgDate(b.PurchaseDate), warranty: pgDate(b.WarrantyEnd), license: pgDate(b.LicenseEnd),
		eol: pgDate(b.EolDate), eos: pgDate(b.EosDate), site: b.SiteId,
		location: b.LocationId, rack: b.RackId, uHeight: 1, custom: map[string]any{},
		mgmt: b.MgmtInterfaceId, template: b.TemplateId, cluster: b.ClusterId, catalog: strings.TrimSpace(str(b.CatalogId)),
	}
	if f.template != nil && f.catalog != "" {
		return f, "Chọn template của tổ chức hoặc template hệ thống, không cả hai"
	}
	if b.ClusterRole != nil {
		if !b.ClusterRole.Valid() {
			return f, "Vai trò trong cụm không hợp lệ"
		}
		f.clusterRole = pgtype.Text{String: string(*b.ClusterRole), Valid: true}
	}
	if b.ClusterMemberNo != nil {
		if *b.ClusterMemberNo < 1 || *b.ClusterMemberNo > 99 {
			return f, "Số thứ tự thành viên từ 1 đến 99"
		}
		f.clusterNo = pgtype.Int4{Int32: *b.ClusterMemberNo, Valid: true}
	}
	if b.ClusterId == nil {
		f.clusterRole, f.clusterNo = pgtype.Text{}, pgtype.Int4{} // no cluster: no role / number
	}
	if b.PollAddress != nil && strings.TrimSpace(*b.PollAddress) != "" {
		a, err := netip.ParseAddr(strings.TrimSpace(*b.PollAddress))
		if err != nil || a.Zone() != "" {
			return f, "Địa chỉ poll không hợp lệ (một địa chỉ IP, không kèm /prefix)"
		}
		a = a.Unmap()
		f.poll = &a
	}
	if b.Role != nil {
		f.role = string(*b.Role)
	}
	if b.Lifecycle != nil {
		f.lifecycle = string(*b.Lifecycle)
	}
	if b.Managed != nil {
		f.managed = *b.Managed
	}
	// The Internet / a carrier network drawn as a cloud is not an asset we manage (ADR-033).
	if f.typ == "provider_cloud" {
		f.managed = false
	}
	if b.UHeight != nil {
		f.uHeight, f.uHeightSet = *b.UHeight, true
	}
	if b.RackU != nil {
		f.rackU = pgtype.Int4{Int32: *b.RackU, Valid: true}
	}
	if b.CustomFields != nil {
		f.custom = *b.CustomFields
	}
	var msg string
	if f.tags, msg = normalizeTags(derefTags(b.Tags)); msg != "" {
		return f, msg
	}
	switch {
	case f.hostname == "" || tooLong(f.hostname, 253) || !hostnameRe.MatchString(f.hostname):
		return f, "Hostname bắt buộc: chữ, số, dấu chấm, gạch ngang, gạch dưới; tối đa 253 ký tự"
	case !b.Type.Valid():
		return f, "Loại thiết bị không hợp lệ"
	case !apigen.DeviceRole(f.role).Valid():
		return f, "Vai trò không hợp lệ"
	case !apigen.DeviceLifecycle(f.lifecycle).Valid():
		return f, "Trạng thái vòng đời không hợp lệ"
	case slices.ContainsFunc([]string{f.vendor, f.model, f.partNumber, f.serial, f.assetTag, f.firmware, f.po}, func(s string) bool { return tooLong(s, 100) }),
		tooLong(f.owner, 200), tooLong(f.notes, 4000):
		return f, "Một trường vượt quá độ dài cho phép"
	case f.uHeight < 1 || f.uHeight > 60:
		return f, "Chiều cao phải từ 1 đến 60U"
	case f.rackU.Valid && (f.rack == nil || f.rackU.Int32 < 1 || f.rackU.Int32 > 60):
		return f, "Vị trí U cần chọn rack và từ 1 đến 60"
	}
	return f, ""
}

func derefTags(t *[]string) []string {
	if t == nil {
		return nil
	}
	return *t
}

// checkCustomFields validates values against the organization's definitions: no unknown keys, right kind,
// required ones present. Values are normalized (trimmed strings; empty values dropped).
func checkCustomFields(defs []store.CustomFieldDef, in map[string]any) (map[string]any, string) {
	out := map[string]any{}
	byKey := map[string]store.CustomFieldDef{}
	for _, d := range defs {
		byKey[d.Key] = d
	}
	for k, v := range in {
		d, ok := byKey[k]
		if !ok {
			return nil, fmt.Sprintf("Trường tùy biến %q không tồn tại", k)
		}
		if v == nil {
			continue
		}
		bad := fmt.Sprintf("Giá trị trường %q không hợp lệ", d.Label)
		switch d.Kind {
		case "number":
			n, ok := v.(float64)
			if !ok {
				return nil, bad
			}
			out[k] = n
		case "boolean":
			b, ok := v.(bool)
			if !ok {
				return nil, bad
			}
			out[k] = b
		default: // text, date, select
			s, ok := v.(string)
			if !ok {
				return nil, bad
			}
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			switch {
			case tooLong(s, 1000):
				return nil, bad
			case d.Kind == "date":
				if _, err := time.Parse(time.DateOnly, s); err != nil || !isoDateRe.MatchString(s) {
					return nil, bad
				}
			case d.Kind == "select" && !slices.Contains(d.Options, s):
				return nil, bad
			}
			out[k] = s
		}
	}
	for _, d := range defs {
		if _, ok := out[d.Key]; d.Required && !ok {
			return nil, fmt.Sprintf("Trường %q bắt buộc", d.Label)
		}
	}
	return out, ""
}

// placement is the resolved site / location / rack of a device.
type placement struct {
	site           store.GetSiteRow
	location, rack pgtype.UUID
	rackU          pgtype.Int4
}

// resolvePlacement checks the site (in the organization), the location / rack (in that site) and the rack slot
// (free U). `self` excludes the device itself from the overlap check.
func resolvePlacement(ctx context.Context, q store.Querier, m tenant.Membership, f deviceFields, self pgtype.UUID) (placement, string, error) {
	var p placement
	site, ok, err := loadSite(ctx, q, m, f.site)
	if err != nil {
		return p, "", err
	}
	if !ok {
		return p, "Site không tồn tại trong tổ chức", nil
	}
	p.site = site
	var rack store.Rack
	if f.rack != nil {
		rack, err = q.GetRack(ctx, store.GetRackParams{ID: pgUUID(*f.rack), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return p, "Rack không thuộc site đã chọn", nil
		}
		if err != nil {
			return p, "", fmt.Errorf("load rack: %w", err)
		}
		p.rack = rack.ID
		p.location = rack.LocationID // a rack fixes the location
	}
	if f.location != nil {
		loc, err := q.GetLocation(ctx, store.GetLocationParams{ID: pgUUID(*f.location), OrganizationID: m.OrgID, SiteID: site.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return p, "Location không thuộc site đã chọn", nil
		}
		if err != nil {
			return p, "", fmt.Errorf("load location: %w", err)
		}
		if p.rack.Valid && loc.ID != rack.LocationID {
			return p, "Rack không nằm trong location đã chọn", nil
		}
		p.location = loc.ID
	}
	if f.rackU.Valid {
		top := f.rackU.Int32 + f.uHeight - 1
		if top > rack.UHeight {
			return p, fmt.Sprintf("Rack %s chỉ có %dU", rack.Name, rack.UHeight), nil
		}
		used, err := q.RackOccupancy(ctx, store.RackOccupancyParams{OrganizationID: m.OrgID, RackID: rack.ID})
		if err != nil {
			return p, "", fmt.Errorf("rack occupancy: %w", err)
		}
		for _, o := range used {
			if o.ID == self {
				continue
			}
			oTop := o.RackU.Int32 + o.UHeight - 1
			if f.rackU.Int32 <= oTop && o.RackU.Int32 <= top {
				return p, fmt.Sprintf("U%d–U%d của rack %s đã có %s", o.RackU.Int32, oTop, rack.Name, o.Hostname), nil
			}
		}
		p.rackU = f.rackU
	}
	return p, "", nil
}

type deviceSnapshot struct {
	Hostname     string         `json:"hostname"`
	Type         string         `json:"type"`
	Vendor       string         `json:"vendor"`
	Model        string         `json:"model"`
	PartNumber   string         `json:"partNumber"`
	SerialNumber string         `json:"serialNumber"`
	AssetTag     string         `json:"assetTag"`
	Firmware     string         `json:"firmware"`
	Role         string         `json:"role"`
	Lifecycle    string         `json:"lifecycle"`
	Managed      bool           `json:"managed"`
	OwnerName    string         `json:"ownerName"`
	PurchaseDate string         `json:"purchaseDate,omitempty"`
	PoNumber     string         `json:"poNumber"`
	WarrantyEnd  string         `json:"warrantyEnd,omitempty"`
	LicenseEnd   string         `json:"licenseEnd,omitempty"`
	EolDate      string         `json:"eolDate,omitempty"`
	EosDate      string         `json:"eosDate,omitempty"`
	Notes        string         `json:"notes"`
	Tags         []string       `json:"tags"`
	CustomFields map[string]any `json:"customFields"`
	Site         string         `json:"site"`
	Category     string         `json:"category,omitempty"`
	Location     string         `json:"location,omitempty"`
	Rack         string         `json:"rack,omitempty"`
	RackU        int32          `json:"rackU,omitempty"`
	UHeight      int32          `json:"uHeight"`
	MgmtIface    string         `json:"mgmtInterface,omitempty"`
	PollAddress  string         `json:"pollAddress,omitempty"`
	Cluster      string         `json:"cluster,omitempty"`
	ClusterRole  string         `json:"clusterRole,omitempty"`
}

func dateStr(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format(time.DateOnly)
}

func customMap(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

// snapDevice records names next to ids so the history reads without lookups.
func snapDevice(d store.GetDeviceRow) deviceSnapshot {
	s := deviceSnapshot{
		Hostname: d.Hostname, Type: d.Type, Vendor: d.Vendor, Model: d.Model, PartNumber: d.PartNumber, SerialNumber: d.SerialNumber,
		AssetTag: d.AssetTag, Firmware: d.Firmware, Role: d.Role, Lifecycle: d.Lifecycle, Managed: d.Managed, OwnerName: d.OwnerName,
		PurchaseDate: dateStr(d.PurchaseDate), PoNumber: d.PoNumber, WarrantyEnd: dateStr(d.WarrantyEnd), LicenseEnd: dateStr(d.LicenseEnd),
		EolDate: dateStr(d.EolDate), EosDate: dateStr(d.EosDate), Notes: d.Notes, Tags: d.Tags, CustomFields: customMap(d.CustomFields),
		Site: d.SiteCode, Category: d.CategoryPath, Location: d.LocationName, Rack: d.RackName, UHeight: d.UHeight,
	}
	if d.RackID.Valid && d.RackU.Valid {
		s.RackU = d.RackU.Int32
	}
	s.MgmtIface = d.MgmtInterfaceName
	s.Cluster, s.ClusterRole = d.ClusterName, d.ClusterRole.String
	if p := pollString(d.PollAddress); p != nil {
		s.PollAddress = *p
	}
	return s
}

func toDevice(d store.GetDeviceRow, level int) apigen.Device {
	out := apigen.Device{
		Id: uuid.UUID(d.ID.Bytes), Hostname: d.Hostname, Type: apigen.DeviceType(d.Type), Vendor: d.Vendor, Model: d.Model,
		TemplateId: optUUID(d.TemplateID), CatalogId: d.CatalogID,
		PartNumber: d.PartNumber, SerialNumber: d.SerialNumber, AssetTag: d.AssetTag, Firmware: d.Firmware,
		Role: apigen.DeviceRole(d.Role), Lifecycle: apigen.DeviceLifecycle(d.Lifecycle), Managed: d.Managed, OwnerName: d.OwnerName,
		PoNumber: d.PoNumber, PurchaseDate: apiDate(d.PurchaseDate), WarrantyEnd: apiDate(d.WarrantyEnd),
		LicenseEnd: apiDate(d.LicenseEnd), EolDate: apiDate(d.EolDate), EosDate: apiDate(d.EosDate), Notes: d.Notes,
		Tags: d.Tags, CustomFields: customMap(d.CustomFields),
		SiteId: uuid.UUID(d.SiteID.Bytes), SiteCode: d.SiteCode, SiteName: d.SiteName,
		CategoryId: optUUID(d.CategoryID), CategoryPath: d.CategoryPath,
		LocationId: optUUID(d.LocationID), LocationName: d.LocationName, RackId: optUUID(d.RackID), RackName: d.RackName,
		UHeight: d.UHeight, MgmtInterfaceId: optUUID(d.MgmtInterfaceID), MgmtInterfaceName: d.MgmtInterfaceName,
		MgmtIp: d.MgmtIp, PollAddress: pollString(d.PollAddress), ClusterId: optUUID(d.ClusterID), ClusterName: d.ClusterName,
		ClusterKind: d.ClusterKind, ClusterMemberNo: optInt(d.ClusterMemberNo), Access: levelName(level), Version: d.Version, CreatedAt: d.CreatedAt.Time, UpdatedAt: d.UpdatedAt.Time,
	}
	if d.ClusterRole.Valid {
		role := apigen.ClusterRole(d.ClusterRole.String)
		out.ClusterRole = &role
	}
	if out.Tags == nil {
		out.Tags = []string{}
	}
	if d.RackID.Valid && d.RackU.Valid {
		u := d.RackU.Int32
		out.RackU = &u
	}
	return out
}

// deviceLevels: every device has the organization level (ADR-032).
func deviceLevels(_ context.Context, _ store.Querier, m tenant.Membership, rows []store.GetDeviceRow) (map[pgtype.UUID]int, error) {
	out := make(map[pgtype.UUID]int, len(rows))
	for _, d := range rows {
		out[d.ID] = m.Level()
	}
	return out, nil
}

func deviceLevel(ctx context.Context, q store.Querier, m tenant.Membership, d store.GetDeviceRow) (int, error) {
	l, err := deviceLevels(ctx, q, m, []store.GetDeviceRow{d})
	if err != nil {
		return 0, err
	}
	return l[d.ID], nil
}

func loadDevice(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetDeviceRow, bool, error) {
	d, err := q.GetDevice(ctx, store.GetDeviceParams{
		ID: pgUUID(id), OrganizationID: m.OrgID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return d, false, nil
	}
	if err != nil {
		return d, false, fmt.Errorf("load device: %w", err)
	}
	return d, true, nil
}

func (s *Server) ListDevices(ctx context.Context, req apigen.ListDevicesRequestObject) (apigen.ListDevicesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	bad := func(msg string) (apigen.ListDevicesResponseObject, error) {
		return apigen.ListDevices400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	p := req.Params
	page, size := int32(1), int32(devicePageDefault)
	if p.Page != nil {
		if *p.Page < 1 {
			return bad("page phải ≥ 1")
		}
		page = *p.Page
	}
	if p.PageSize != nil {
		if *p.PageSize < 1 || *p.PageSize > devicePageMax {
			return bad(fmt.Sprintf("pageSize phải từ 1 đến %d", devicePageMax))
		}
		size = *p.PageSize
	}
	params := store.ListDevicesParams{
		OrganizationID: m.OrgID, SiteIds: []pgtype.UUID{}, Types: []string{}, Vendors: []string{}, Lifecycles: []string{},
		Roles: []string{}, Tags: []string{}, ClusterIds: []pgtype.UUID{}, SortKey: "hostname", PageLimit: size, PageOffset: (page - 1) * size,
	}
	if p.Q != nil {
		q := strings.TrimSpace(*p.Q)
		if tooLong(q, 200) {
			return bad("Chuỗi tìm kiếm quá dài")
		}
		params.Q = escapeLike(q)
	}
	if p.CategoryId != nil {
		params.CategoryFilter = pgUUID(*p.CategoryId)
	}
	if p.SiteId != nil {
		for _, id := range *p.SiteId {
			params.SiteIds = append(params.SiteIds, pgUUID(id))
		}
	}
	if p.Type != nil {
		for _, t := range *p.Type {
			params.Types = append(params.Types, string(t))
		}
	}
	if p.Vendor != nil {
		params.Vendors = append(params.Vendors, *p.Vendor...)
	}
	if p.Lifecycle != nil {
		for _, l := range *p.Lifecycle {
			params.Lifecycles = append(params.Lifecycles, string(l))
		}
	}
	if p.Role != nil {
		for _, r := range *p.Role {
			params.Roles = append(params.Roles, string(r))
		}
	}
	if p.Tag != nil {
		params.Tags = append(params.Tags, *p.Tag...)
	}
	if p.ClusterId != nil {
		for _, id := range *p.ClusterId {
			params.ClusterIds = append(params.ClusterIds, pgUUID(id))
		}
	}
	if p.Sort != nil {
		if !p.Sort.Valid() {
			return bad("Cột sắp xếp không hợp lệ")
		}
		params.SortKey = map[apigen.ListDevicesParamsSort]string{
			apigen.ListDevicesParamsSortWarrantyEnd: "warranty_end", apigen.ListDevicesParamsSortMgmtIp: "mgmt_ip",
		}[*p.Sort]
		if params.SortKey == "" {
			params.SortKey = string(*p.Sort)
		}
	}
	params.SortDesc = p.Desc != nil && *p.Desc

	rows, err := s.q.ListDevices(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	total, err := s.q.CountDevices(ctx, store.CountDevicesParams{
		OrganizationID: params.OrganizationID, Q: params.Q,
		CategoryFilter: params.CategoryFilter, SiteIds: params.SiteIds, Types: params.Types,
		Vendors: params.Vendors, Lifecycles: params.Lifecycles, Roles: params.Roles, Tags: params.Tags,
		ClusterIds: params.ClusterIds,
	})
	if err != nil {
		return nil, fmt.Errorf("count devices: %w", err)
	}
	counts, err := s.q.DeviceFacetCounts(ctx, store.DeviceFacetCountsParams{
		OrganizationID: params.OrganizationID, Q: params.Q,
		CategoryFilter: params.CategoryFilter, SiteIds: params.SiteIds, Types: params.Types,
		Vendors: params.Vendors, Lifecycles: params.Lifecycles, Roles: params.Roles, Tags: params.Tags,
		ClusterIds: params.ClusterIds,
	})
	if err != nil {
		return nil, fmt.Errorf("device facets: %w", err)
	}
	conv := make([]store.GetDeviceRow, len(rows))
	for i, r := range rows {
		conv[i] = store.GetDeviceRow(r)
	}
	levels, err := deviceLevels(ctx, s.q, m, conv)
	if err != nil {
		return nil, err
	}
	out := apigen.DeviceList{Devices: make([]apigen.Device, 0, len(rows)), Total: total, Facets: map[string]map[string]int64{}}
	for _, f := range []string{"site", "type", "vendor", "lifecycle", "role", "tag", "cluster"} {
		out.Facets[f] = map[string]int64{}
	}
	for _, c := range counts {
		out.Facets[c.Facet][c.Value] = c.N
	}
	for _, d := range conv {
		out.Devices = append(out.Devices, toDevice(d, levels[d.ID]))
	}
	return apigen.ListDevices200JSONResponse(out), nil
}

func (s *Server) GetDevice(ctx context.Context, req apigen.GetDeviceRequestObject) (apigen.GetDeviceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := loadDevice(ctx, s.q, m, req.DeviceId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetDevice404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	}
	level, err := deviceLevel(ctx, s.q, m, d)
	if err != nil {
		return nil, err
	}
	return apigen.GetDevice200JSONResponse(toDevice(d, level)), nil
}

// writeDevice is the shared create / update transaction body after validation.
type deviceOutcome struct {
	device    store.GetDeviceRow
	bad       string
	conflict  string
	forbidden bool
	notFound  bool
}

func (s *Server) saveDevice(ctx context.Context, m tenant.Membership, f deviceFields, id *uuid.UUID, version int32) (deviceOutcome, error) {
	var out deviceOutcome
	err := s.withTx(ctx, func(q store.Querier) error { return writeDevice(ctx, q, m, f, id, version, &out) })
	return out, err
}

// writeDevice creates (id nil) or updates a device inside the caller's transaction; a refusal is reported in out
// with errRollback.
func writeDevice(ctx context.Context, q store.Querier, m tenant.Membership, f deviceFields, id *uuid.UUID, version int32, out *deviceOutcome) error {
	{
		var before store.GetDeviceRow
		self := pgtype.UUID{}
		if id != nil {
			var ok bool
			var err error
			if before, ok, err = loadDevice(ctx, q, m, *id); err != nil {
				return err
			}
			if !ok {
				out.notFound = true
				return errRollback
			}
			level, err := deviceLevel(ctx, q, m, before)
			if err != nil {
				return err
			}
			if level < tenant.LevelEdit {
				out.forbidden = true
				return errRollback
			}
			self = before.ID
		}
		p, bad, err := resolvePlacement(ctx, q, m, f, self)
		if err != nil {
			return err
		}
		if bad != "" {
			out.bad = bad
			return errRollback
		}
		if !m.CanEdit() {
			out.forbidden = true
			return errRollback
		}
		// Members sit in the cluster's site (ADR-027).
		var cluster pgtype.UUID
		if f.cluster != nil {
			c, ok, err := loadCluster(ctx, q, m, *f.cluster)
			if err != nil {
				return err
			}
			if !ok {
				out.bad = msgClusterNotFound
				return errRollback
			}
			if c.SiteID != p.site.ID {
				out.bad = fmt.Sprintf("Thành viên cụm %s phải ở site %s", c.Name, c.SiteCode)
				return errRollback
			}
			if bad, err := checkMemberType(ctx, q, m, c, self, f.typ); err != nil {
				return err
			} else if bad != "" {
				out.bad = bad
				return errRollback
			}
			cluster = c.ID
		}
		// Hostnames are unique among live devices except within one cluster (a stack); serialized per hostname. A provider
		// cloud is a name on the drawing ("Internet", "VNPT MPLS"), drawn as often as needed (ADR-033).
		if f.typ != "provider_cloud" {
			if err := q.LockHostname(ctx, m.OrgID.String()+"/"+strings.ToLower(f.hostname)); err != nil {
				return fmt.Errorf("lock hostname: %w", err)
			}
			if n, err := q.CountHostnameConflicts(ctx, store.CountHostnameConflictsParams{
				OrganizationID: m.OrgID, Hostname: f.hostname, SelfID: self, ClusterID: cluster,
			}); err != nil {
				return fmt.Errorf("check hostname: %w", err)
			} else if n > 0 {
				out.conflict = msgDeviceDuplicate
				return errRollback
			}
		}
		// A template fills what the user left empty and later generates the ports (create only, P1-09).
		var tpl *store.DeviceTemplate
		if id == nil && f.template != nil {
			t, err := q.GetDeviceTemplate(ctx, store.GetDeviceTemplateParams{ID: pgUUID(*f.template), OrganizationID: m.OrgID})
			if errors.Is(err, pgx.ErrNoRows) {
				out.bad = msgTemplateNotFound
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("load template: %w", err)
			}
			tpl = &t
			if f.vendor == "" {
				f.vendor = t.Vendor
			}
			if f.model == "" {
				f.model = t.Model
			}
			if f.partNumber == "" {
				f.partNumber = t.PartNumber
			}
			if !f.uHeightSet {
				f.uHeight = t.UHeight
			}
		}
		// A system template (built-in catalog, ADR-035) does the same without being copied into the organization.
		var catalogPorts *store.DeviceTemplate
		catalogID := ""
		if id == nil && f.catalog != "" {
			c, ok := catalog.Get(f.catalog)
			if !ok {
				out.bad = "Không có model này trong template hệ thống"
				return errRollback
			}
			if f.vendor == "" {
				f.vendor = c.Vendor
			}
			if f.model == "" {
				f.model = c.Model
			}
			if f.partNumber == "" && len(c.PartNumbers) > 0 {
				f.partNumber = c.PartNumbers[0]
			}
			if !f.uHeightSet {
				f.uHeight = c.UHeight
			}
			raw, err := json.Marshal(c.Ports)
			if err != nil {
				return fmt.Errorf("encode catalog ports: %w", err)
			}
			catalogPorts = &store.DeviceTemplate{Ports: raw}
			catalogID = c.Id
		}
		// The management interface must be one of the device's own (ADR-012).
		var mgmt pgtype.UUID
		if id != nil && f.mgmt != nil {
			i, err := q.GetInterface(ctx, store.GetInterfaceParams{ID: pgUUID(*f.mgmt), OrganizationID: m.OrgID, DeviceID: before.ID})
			if errors.Is(err, pgx.ErrNoRows) {
				out.bad = "Interface quản trị phải là interface của thiết bị này"
				return errRollback
			}
			if err != nil {
				return fmt.Errorf("load interface: %w", err)
			}
			mgmt = i.ID
		}
		defs, err := q.ListCustomFieldDefs(ctx, m.OrgID)
		if err != nil {
			return fmt.Errorf("list custom fields: %w", err)
		}
		custom, bad := checkCustomFields(defs, f.custom)
		if bad != "" {
			out.bad = bad
			return errRollback
		}
		customJSON, err := json.Marshal(custom)
		if err != nil {
			return fmt.Errorf("encode custom fields: %w", err)
		}
		var devID pgtype.UUID
		if id == nil {
			devID, err = q.CreateDevice(ctx, store.CreateDeviceParams{
				OrganizationID: m.OrgID, SiteID: p.site.ID, LocationID: p.location, RackID: p.rack,
				RackU: p.rackU, UHeight: f.uHeight, Hostname: f.hostname, Type: f.typ, Vendor: f.vendor, Model: f.model,
				PartNumber: f.partNumber, SerialNumber: f.serial, AssetTag: f.assetTag, Firmware: f.firmware, Role: f.role,
				Lifecycle: f.lifecycle, Managed: f.managed, OwnerName: f.owner, PurchaseDate: f.purchase, PoNumber: f.po,
				WarrantyEnd: f.warranty, LicenseEnd: f.license, EolDate: f.eol, EosDate: f.eos, Notes: f.notes, Tags: f.tags,
				CustomFields: customJSON, TemplateID: templateID(tpl), CatalogID: catalogID, PollAddress: f.poll,
				ClusterID: cluster, ClusterRole: f.clusterRole, ClusterMemberNo: f.clusterNo,
			})
		} else {
			devID = before.ID
			var n int64
			n, err = q.UpdateDevice(ctx, store.UpdateDeviceParams{
				ID: before.ID, OrganizationID: m.OrgID, Version: version, SiteID: p.site.ID,
				LocationID: p.location, RackID: p.rack, RackU: p.rackU, UHeight: f.uHeight, Hostname: f.hostname, Type: f.typ,
				Vendor: f.vendor, Model: f.model, PartNumber: f.partNumber, SerialNumber: f.serial, AssetTag: f.assetTag,
				Firmware: f.firmware, Role: f.role, Lifecycle: f.lifecycle, Managed: f.managed, OwnerName: f.owner,
				PurchaseDate: f.purchase, PoNumber: f.po, WarrantyEnd: f.warranty, LicenseEnd: f.license, EolDate: f.eol,
				EosDate: f.eos, Notes: f.notes, Tags: f.tags, CustomFields: customJSON, MgmtInterfaceID: mgmt, PollAddress: f.poll,
				ClusterID: cluster, ClusterRole: f.clusterRole, ClusterMemberNo: f.clusterNo,
			})
			if err == nil && n == 0 {
				out.conflict = msgStale
				return errRollback
			}
		}
		if isUniqueViolation(err) {
			out.conflict = "Số thứ tự thành viên đã dùng trong cụm"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("save device: %w", err)
		}
		for _, t := range []*store.DeviceTemplate{tpl, catalogPorts} {
			if t != nil {
				if _, err := generatePorts(ctx, q, m, devID, *t, f.clusterNo.Int32); err != nil {
					return err
				}
			}
		}
		after, ok, err := loadDevice(ctx, q, m, uuid.UUID(devID.Bytes))
		if err != nil {
			return err
		}
		if !ok {
			// Saved somewhere the caller no longer sees (e.g. moved out of a shared site): refuse instead.
			out.forbidden = true
			return errRollback
		}
		out.device = after
		entry := audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.create", ObjectType: "device", ObjectID: uuidStr(devID),
			After: snapDevice(after), Meta: infoFrom(ctx).meta,
		}
		if id != nil {
			entry.Action, entry.Before = "device.update", snapDevice(before)
		}
		return audit.Write(ctx, q, entry)
	}
}

// inputFromUpdate: the fields of a DeviceUpdate that an update writes (template is create-only).
func inputFromUpdate(b apigen.DeviceUpdate) apigen.DeviceInput {
	return apigen.DeviceInput{
		Hostname: b.Hostname, Type: b.Type, Vendor: b.Vendor, Model: b.Model, PartNumber: b.PartNumber, SerialNumber: b.SerialNumber,
		AssetTag: b.AssetTag, Firmware: b.Firmware, OwnerName: b.OwnerName, PoNumber: b.PoNumber, Notes: b.Notes, Role: b.Role,
		Lifecycle: b.Lifecycle, Managed: b.Managed, PurchaseDate: b.PurchaseDate, WarrantyEnd: b.WarrantyEnd, LicenseEnd: b.LicenseEnd,
		EolDate: b.EolDate, EosDate: b.EosDate, Tags: b.Tags, CustomFields: b.CustomFields, SiteId: b.SiteId,
		LocationId: b.LocationId, RackId: b.RackId, RackU: b.RackU, UHeight: b.UHeight,
		MgmtInterfaceId: b.MgmtInterfaceId, PollAddress: b.PollAddress,
		ClusterId: b.ClusterId, ClusterRole: b.ClusterRole, ClusterMemberNo: b.ClusterMemberNo,
	}
}

func bodyFromInput(b apigen.DeviceInput) deviceBody {
	return deviceBody{
		Hostname: b.Hostname, Type: b.Type, Vendor: b.Vendor, Model: b.Model, PartNumber: b.PartNumber, SerialNumber: b.SerialNumber,
		AssetTag: b.AssetTag, Firmware: b.Firmware, OwnerName: b.OwnerName, PoNumber: b.PoNumber, Notes: b.Notes, Role: b.Role,
		Lifecycle: b.Lifecycle, Managed: b.Managed, PurchaseDate: b.PurchaseDate, WarrantyEnd: b.WarrantyEnd, LicenseEnd: b.LicenseEnd,
		EolDate: b.EolDate, EosDate: b.EosDate, Tags: b.Tags, CustomFields: b.CustomFields, SiteId: b.SiteId,
		LocationId: b.LocationId, RackId: b.RackId, RackU: b.RackU, UHeight: b.UHeight,
		MgmtInterfaceId: b.MgmtInterfaceId, TemplateId: b.TemplateId, CatalogId: b.CatalogId, PollAddress: b.PollAddress,
		ClusterId: b.ClusterId, ClusterRole: b.ClusterRole, ClusterMemberNo: b.ClusterMemberNo,
	}
}

func (s *Server) CreateDevice(ctx context.Context, req apigen.CreateDeviceRequestObject) (apigen.CreateDeviceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.CreateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateDevice(bodyFromInput(*req.Body))
	if msg != "" {
		return apigen.CreateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	out, err := s.saveDevice(ctx, m, f, nil, 0)
	switch {
	case err != nil:
		return nil, err
	case out.bad != "":
		return apigen.CreateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.forbidden:
		return apigen.CreateDevice403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.conflict != "":
		return apigen.CreateDevice409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	level, err := deviceLevel(ctx, s.q, m, out.device)
	if err != nil {
		return nil, err
	}
	return apigen.CreateDevice201JSONResponse(toDevice(out.device, level)), nil
}

func (s *Server) UpdateDevice(ctx context.Context, req apigen.UpdateDeviceRequestObject) (apigen.UpdateDeviceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.UpdateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	b := req.Body
	f, msg := validateDevice(bodyFromInput(inputFromUpdate(*b)))
	if msg != "" {
		// Unknown / invisible devices answer 404 before validation messages reveal anything.
		if _, ok, err := loadDevice(ctx, s.q, m, req.DeviceId); err != nil {
			return nil, err
		} else if !ok {
			return apigen.UpdateDevice404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
		}
		return apigen.UpdateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	id := req.DeviceId
	out, err := s.saveDevice(ctx, m, f, &id, b.Version)
	switch {
	case err != nil:
		return nil, err
	case out.notFound:
		return apigen.UpdateDevice404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.forbidden:
		return apigen.UpdateDevice403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.UpdateDevice400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conflict != "":
		return apigen.UpdateDevice409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conflict}}, nil
	}
	level, err := deviceLevel(ctx, s.q, m, out.device)
	if err != nil {
		return nil, err
	}
	return apigen.UpdateDevice200JSONResponse(toDevice(out.device, level)), nil
}

// deleteDevices soft-deletes all ids or none: every id must be visible (else 404) and the caller must edit
// its unit directly (else 403).
func (s *Server) deleteDevices(ctx context.Context, m tenant.Membership, ids []uuid.UUID) (int, error) {
	code := 0
	err := s.withTx(ctx, func(q store.Querier) error {
		for _, id := range ids {
			var err error
			if code, err = deleteDeviceTx(ctx, q, m, id); err != nil || code != 0 {
				return orRollback(err)
			}
		}
		return nil
	})
	return code, err
}

// deleteDeviceTx soft-deletes one device with its links inside the caller's transaction; 404 / 403 refuse.
func deleteDeviceTx(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (int, error) {
	d, ok, err := loadDevice(ctx, q, m, id)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 404, nil
	}
	if !m.CanEdit() {
		return 403, nil
	}
	if _, err := q.SoftDeleteDevice(ctx, store.SoftDeleteDeviceParams{ID: d.ID, OrganizationID: m.OrgID}); err != nil {
		return 0, fmt.Errorf("delete device: %w", err)
	}
	if err := deleteLinksOf(ctx, q, m, "device", d.ID); err != nil {
		return 0, err
	}
	return 0, audit.Write(ctx, q, audit.Entry{
		OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.delete", ObjectType: "device", ObjectID: uuidStr(d.ID),
		Before: snapDevice(d), Meta: infoFrom(ctx).meta,
	})
}

func (s *Server) DeleteDevice(ctx context.Context, req apigen.DeleteDeviceRequestObject) (apigen.DeleteDeviceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	code, err := s.deleteDevices(ctx, m, []uuid.UUID{req.DeviceId})
	switch {
	case code == 404:
		return apigen.DeleteDevice404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case code == 403:
		return apigen.DeleteDevice403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteDevice204Response{}, nil
}

func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func (s *Server) BulkDeleteDevices(ctx context.Context, req apigen.BulkDeleteDevicesRequestObject) (apigen.BulkDeleteDevicesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || len(req.Body.Ids) == 0 || len(req.Body.Ids) > 500 {
		return apigen.BulkDeleteDevices400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Chọn từ 1 đến 500 thiết bị"}}, nil
	}
	ids := uniqueIDs(req.Body.Ids)
	code, err := s.deleteDevices(ctx, m, ids)
	switch {
	case code == 404:
		return apigen.BulkDeleteDevices404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case code == 403:
		return apigen.BulkDeleteDevices403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.BulkDeleteDevices200JSONResponse{Count: int64(len(ids))}, nil
}

// DeviceDeleteImpact lists what deleting devices takes along (ADR-033), for the confirmation before a delete from the
// inventory: every link of the devices, the diagrams showing them, clusters losing a member, IPs released.
func (s *Server) DeviceDeleteImpact(ctx context.Context, req apigen.DeviceDeleteImpactRequestObject) (apigen.DeviceDeleteImpactResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || len(req.Body.Ids) == 0 || len(req.Body.Ids) > 500 {
		return apigen.DeviceDeleteImpact400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Chọn từ 1 đến 500 thiết bị"}}, nil
	}
	ids := []pgtype.UUID{}
	for _, id := range uniqueIDs(req.Body.Ids) {
		ids = append(ids, pgUUID(id))
	}
	rows, err := s.q.DeviceDeleteImpact(ctx, store.DeviceDeleteImpactParams{OrganizationID: m.OrgID, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("delete impact: %w", err)
	}
	out := apigen.DeviceDeleteImpact{Devices: []apigen.DeviceImpact{}, Links: []apigen.Link{}, Diagrams: []apigen.DiagramShowing{}}
	found := make([]string, 0, len(rows))
	var linkRows []store.ListLinksRow
	seen := map[pgtype.UUID]bool{}
	for _, r := range rows {
		out.Devices = append(out.Devices, apigen.DeviceImpact{ClusterMembersLeft: r.ClusterMembersLeft, ClusterName: r.ClusterName,
			Hostname: r.Hostname, Id: uuid.UUID(r.ID.Bytes), IpCount: r.IpCount, SiteCode: r.SiteCode})
		found = append(found, uuidStr(r.ID))
		lr, err := s.q.ListLinks(ctx, store.ListLinksParams{OrganizationID: m.OrgID, EndID: r.ID})
		if err != nil {
			return nil, fmt.Errorf("delete impact links: %w", err)
		}
		for _, l := range lr {
			if !seen[l.ID] {
				seen[l.ID] = true
				linkRows = append(linkRows, l)
			}
		}
	}
	if out.Links, err = visibleLinks(ctx, s.q, m, linkRows); err != nil {
		return nil, err
	}
	if len(found) > 0 {
		dgs, err := s.q.ListDiagramsShowing(ctx, store.ListDiagramsShowingParams{OrganizationID: m.OrgID, Ids: found})
		if err != nil {
			return nil, fmt.Errorf("delete impact diagrams: %w", err)
		}
		for _, d := range dgs {
			refs := make([]openapi_types.UUID, 0, len(d.RefIds))
			for _, id := range d.RefIds {
				if u, err := uuid.Parse(id); err == nil {
					refs = append(refs, u)
				}
			}
			out.Diagrams = append(out.Diagrams, apigen.DiagramShowing{DeviceIds: refs, Id: uuid.UUID(d.ID.Bytes), Name: d.Name})
		}
	}
	return apigen.DeviceDeleteImpact200JSONResponse(out), nil
}

// BulkUpdateDevices changes the given fields on every device, all or nothing; each device keeps its own
// version (no lock: the change is a set, not a replace) and gets its own audit entry.
func (s *Server) BulkUpdateDevices(ctx context.Context, req apigen.BulkUpdateDevicesRequestObject) (apigen.BulkUpdateDevicesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	bad := func(msg string) (apigen.BulkUpdateDevicesResponseObject, error) {
		return apigen.BulkUpdateDevices400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	b := req.Body
	if b == nil || len(b.Ids) == 0 || len(b.Ids) > 500 {
		return bad("Chọn từ 1 đến 500 thiết bị")
	}
	switch {
	case b.Lifecycle != nil && !b.Lifecycle.Valid():
		return bad("Trạng thái vòng đời không hợp lệ")
	case b.Role != nil && !b.Role.Valid():
		return bad("Vai trò không hợp lệ")
	case b.OwnerName != nil && tooLong(*b.OwnerName, 200):
		return bad("Người phụ trách tối đa 200 ký tự")
	}
	add, msg := normalizeTags(derefTags(b.AddTags))
	if msg != "" {
		return bad(msg)
	}
	remove, msg := normalizeTags(derefTags(b.RemoveTags))
	if msg != "" {
		return bad(msg)
	}
	if b.Lifecycle == nil && b.Role == nil && b.OwnerName == nil && b.Managed == nil && len(add) == 0 && len(remove) == 0 {
		return bad("Chưa chọn thay đổi nào")
	}
	ids := uniqueIDs(b.Ids)
	code := 0
	err = s.withTx(ctx, func(q store.Querier) error {
		for _, id := range ids {
			d, ok, err := loadDevice(ctx, q, m, id)
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
			next := d
			if b.Lifecycle != nil {
				next.Lifecycle = string(*b.Lifecycle)
			}
			if b.Role != nil {
				next.Role = string(*b.Role)
			}
			if b.OwnerName != nil {
				next.OwnerName = strings.TrimSpace(*b.OwnerName)
			}
			if b.Managed != nil {
				next.Managed = *b.Managed
			}
			tags := slices.DeleteFunc(slices.Clone(d.Tags), func(t string) bool {
				return slices.ContainsFunc(remove, func(r string) bool { return strings.EqualFold(r, t) })
			})
			if next.Tags, msg = normalizeTags(append(tags, add...)); msg != "" {
				code = 400
				return errRollback
			}
			if _, err := q.UpdateDevice(ctx, store.UpdateDeviceParams{
				ID: d.ID, OrganizationID: m.OrgID, Version: d.Version, SiteID: d.SiteID,
				LocationID: d.LocationID, RackID: d.RackID, RackU: d.RackU, UHeight: d.UHeight, Hostname: d.Hostname, Type: d.Type,
				Vendor: d.Vendor, Model: d.Model, PartNumber: d.PartNumber, SerialNumber: d.SerialNumber, AssetTag: d.AssetTag,
				Firmware: d.Firmware, Role: next.Role, Lifecycle: next.Lifecycle, Managed: next.Managed, OwnerName: next.OwnerName,
				PurchaseDate: d.PurchaseDate, PoNumber: d.PoNumber, WarrantyEnd: d.WarrantyEnd, LicenseEnd: d.LicenseEnd,
				EolDate: d.EolDate, EosDate: d.EosDate, Notes: d.Notes, Tags: next.Tags, CustomFields: d.CustomFields,
				MgmtInterfaceID: d.MgmtInterfaceID, PollAddress: d.PollAddress,
				ClusterID: d.ClusterID, ClusterRole: d.ClusterRole, ClusterMemberNo: d.ClusterMemberNo,
			}); err != nil {
				return fmt.Errorf("bulk update device: %w", err)
			}
			if err := audit.Write(ctx, q, audit.Entry{
				OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.update", ObjectType: "device", ObjectID: uuidStr(d.ID),
				Before: snapDevice(d), After: snapDevice(next), Meta: infoFrom(ctx).meta,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	switch {
	case code == 404:
		return apigen.BulkUpdateDevices404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case code == 403:
		return apigen.BulkUpdateDevices403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case code == 400:
		return bad(msg)
	case err != nil:
		return nil, err
	}
	return apigen.BulkUpdateDevices200JSONResponse{Count: int64(len(ids))}, nil
}

func (s *Server) GetDeviceHistory(ctx context.Context, req apigen.GetDeviceHistoryRequestObject) (apigen.GetDeviceHistoryResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := loadDevice(ctx, s.q, m, req.DeviceId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.GetDeviceHistory404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	}
	rows, err := s.q.ListDeviceHistory(ctx, store.ListDeviceHistoryParams{OrganizationID: m.OrgID, DeviceID: uuidStr(d.ID)})
	if err != nil {
		return nil, fmt.Errorf("device history: %w", err)
	}
	out := apigen.DeviceHistory{}
	out.Entries = make([]struct {
		Action     string                  `json:"action"`
		ActorEmail string                  `json:"actorEmail"`
		ActorName  string                  `json:"actorName"`
		After      *map[string]interface{} `json:"after"`
		At         time.Time               `json:"at"`
		Before     *map[string]interface{} `json:"before"`
		Id         int64                   `json:"id"`
	}, len(rows))
	obj := func(raw []byte) *map[string]any {
		if len(raw) == 0 {
			return nil
		}
		v := map[string]any{}
		if json.Unmarshal(raw, &v) != nil {
			return nil
		}
		return &v
	}
	for i, r := range rows {
		e := &out.Entries[i]
		e.Id, e.At, e.Action, e.ActorEmail, e.ActorName = r.ID, r.CreatedAt.Time, r.Action, r.ActorEmail, r.ActorName
		e.Before, e.After = obj(r.Before), obj(r.After)
	}
	return apigen.GetDeviceHistory200JSONResponse(out), nil
}

func templateID(t *store.DeviceTemplate) pgtype.UUID {
	if t == nil {
		return pgtype.UUID{}
	}
	return t.ID
}

func pollString(a *netip.Addr) *string {
	if a == nil {
		return nil
	}
	v := a.String()
	return &v
}
