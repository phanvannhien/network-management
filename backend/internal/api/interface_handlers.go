package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Templates, interfaces and IPs (P1-09, SRS §4.2–4.3, ADR-012). Templates belong to the organization: any member
// reads them, organization owners/admins/editors write them. Interfaces and IPs follow the device: visible with
// the device, changed with edit access on it. Their audit entries are filed under the device so they show in its
// history.

const (
	msgInterfaceNotFound = "Không tìm thấy interface"
	msgIPNotFound        = "Không tìm thấy địa chỉ IP"
	msgTemplateNotFound  = "Không tìm thấy template"
	maxTemplatePorts     = 1024
)

var vlanListRe = regexp.MustCompile(`^([0-9]{1,4}(-[0-9]{1,4})?(,[0-9]{1,4}(-[0-9]{1,4})?)*)?$`)

// --- port expansion ---

type port struct {
	name, media, speed string
	poe                bool
}

// expandPorts turns template port groups into port names ("Gi1/0/{n}", start 1, count 24 → Gi1/0/1 … Gi1/0/24).
// {m} is the stack member number, so member 2 of a stack gets Gi2/0/1 … from "Gi{m}/0/{n}".
func expandPorts(groups []apigen.PortGroup, member int32) ([]port, string) {
	out := []port{}
	seen := map[string]bool{}
	for _, g := range groups {
		pattern := strings.TrimSpace(g.Pattern)
		switch {
		case pattern == "" || tooLong(pattern, 60):
			return nil, "Mẫu tên cổng bắt buộc, tối đa 60 ký tự"
		case g.Count < 1 || g.Count > 512 || g.Start < 0 || g.Start > 9999:
			return nil, "Số cổng từ 1 đến 512, số bắt đầu từ 0 đến 9999"
		case g.Count > 1 && !strings.Contains(pattern, "{n}"):
			return nil, "Nhóm nhiều cổng cần {n} trong mẫu tên, vd Gi1/0/{n}"
		case g.Media != nil && !g.Media.Valid():
			return nil, "Loại media không hợp lệ"
		case g.Speed != nil && tooLong(*g.Speed, 20):
			return nil, "Tốc độ tối đa 20 ký tự"
		}
		for n := g.Start; n < g.Start+g.Count; n++ {
			name := strings.ReplaceAll(strings.ReplaceAll(pattern, "{n}", strconv.Itoa(int(n))), "{m}", strconv.Itoa(int(member)))
			if tooLong(name, 64) {
				return nil, "Tên cổng tối đa 64 ký tự"
			}
			if k := strings.ToLower(name); seen[k] {
				return nil, fmt.Sprintf("Tên cổng %s bị lặp", name)
			} else {
				seen[k] = true
			}
			p := port{name: name, poe: g.Poe != nil && *g.Poe}
			if g.Media != nil {
				p.media = string(*g.Media)
			}
			if g.Speed != nil {
				p.speed = strings.TrimSpace(*g.Speed)
			}
			out = append(out, p)
		}
	}
	if len(out) > maxTemplatePorts {
		return nil, fmt.Sprintf("Tối đa %d cổng mỗi template", maxTemplatePorts)
	}
	return out, ""
}

// generatePorts adds the template's ports a device lacks; returns how many were added.
func generatePorts(ctx context.Context, q store.Querier, m tenant.Membership, device pgtype.UUID, tpl store.DeviceTemplate, member int32) (int64, error) {
	var groups []apigen.PortGroup
	if err := json.Unmarshal(tpl.Ports, &groups); err != nil {
		return 0, fmt.Errorf("decode template ports: %w", err)
	}
	ports, msg := expandPorts(groups, max(member, 1))
	if msg != "" {
		return 0, fmt.Errorf("stored template is invalid: %s", msg)
	}
	sort, err := q.MaxInterfaceSort(ctx, store.MaxInterfaceSortParams{OrganizationID: m.OrgID, DeviceID: device})
	if err != nil {
		return 0, fmt.Errorf("interface sort: %w", err)
	}
	var added int64
	for _, p := range ports {
		sort++
		n, err := q.CreateInterfaceIfMissing(ctx, store.CreateInterfaceIfMissingParams{
			OrganizationID: m.OrgID, DeviceID: device, Name: p.name, Media: p.media, Speed: p.speed, Poe: p.poe, SortOrder: sort,
		})
		if err != nil {
			return 0, fmt.Errorf("create port: %w", err)
		}
		added += n
	}
	return added, nil
}

// --- templates ---

func toTemplate(t store.DeviceTemplate) apigen.DeviceTemplate {
	groups := []apigen.PortGroup{}
	_ = json.Unmarshal(t.Ports, &groups)
	ports, _ := expandPorts(groups, 1)
	return apigen.DeviceTemplate{
		Id: uuid.UUID(t.ID.Bytes), Name: t.Name, Type: apigen.DeviceType(t.Type), Vendor: t.Vendor, Model: t.Model,
		PartNumber: t.PartNumber, UHeight: t.UHeight, Ports: groups, PortCount: int32(len(ports)), Notes: t.Notes, Version: t.Version,
	}
}

type templateFields struct {
	name, typ, vendor, model, partNumber, notes string
	uHeight                                     int32
	ports                                       []byte
}

func validateTemplate(name string, typ apigen.DeviceType, vendor, model, partNumber, notes *string, uHeight *int32, ports *[]apigen.PortGroup) (templateFields, string) {
	f := templateFields{
		name: strings.TrimSpace(name), typ: string(typ), vendor: strings.TrimSpace(str(vendor)), model: strings.TrimSpace(str(model)),
		partNumber: strings.TrimSpace(str(partNumber)), notes: str(notes), uHeight: 1,
	}
	if uHeight != nil {
		f.uHeight = *uHeight
	}
	groups := []apigen.PortGroup{}
	if ports != nil {
		groups = *ports
	}
	switch {
	case f.name == "" || tooLong(f.name, 100):
		return f, "Tên template bắt buộc, tối đa 100 ký tự"
	case !typ.Valid():
		return f, "Loại thiết bị không hợp lệ"
	case tooLong(f.vendor, 100) || tooLong(f.model, 100) || tooLong(f.partNumber, 100) || tooLong(f.notes, 2000):
		return f, "Một trường vượt quá độ dài cho phép"
	case f.uHeight < 1 || f.uHeight > 60:
		return f, "Chiều cao phải từ 1 đến 60U"
	case len(groups) > 50:
		return f, "Tối đa 50 nhóm cổng"
	}
	if _, msg := expandPorts(groups, 1); msg != "" {
		return f, msg
	}
	f.ports, _ = json.Marshal(groups)
	return f, ""
}

type templateSnapshot struct {
	Name       string          `json:"name"`
	Type       string          `json:"type"`
	Vendor     string          `json:"vendor"`
	Model      string          `json:"model"`
	PartNumber string          `json:"partNumber"`
	Ports      json.RawMessage `json:"ports"`
}

func snapTemplate(t store.DeviceTemplate) templateSnapshot {
	return templateSnapshot{t.Name, t.Type, t.Vendor, t.Model, t.PartNumber, t.Ports}
}

const msgTemplateWrite = "Chỉ owner/admin/editor của tổ chức được quản lý template"

func (s *Server) ListDeviceTemplates(ctx context.Context, req apigen.ListDeviceTemplatesRequestObject) (apigen.ListDeviceTemplatesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListDeviceTemplates(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("list templates: %w", err)
	}
	out := apigen.DeviceTemplateList{Templates: make([]apigen.DeviceTemplate, 0, len(rows))}
	for _, t := range rows {
		out.Templates = append(out.Templates, toTemplate(t))
	}
	return apigen.ListDeviceTemplates200JSONResponse(out), nil
}

func (s *Server) GetDeviceTemplate(ctx context.Context, req apigen.GetDeviceTemplateRequestObject) (apigen.GetDeviceTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	t, err := s.q.GetDeviceTemplate(ctx, store.GetDeviceTemplateParams{ID: pgUUID(req.TemplateId), OrganizationID: m.OrgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return apigen.GetDeviceTemplate404JSONResponse{NotFoundJSONResponse: notFoundBody(msgTemplateNotFound)}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}
	return apigen.GetDeviceTemplate200JSONResponse(toTemplate(t)), nil
}

func (s *Server) CreateDeviceTemplate(ctx context.Context, req apigen.CreateDeviceTemplateRequestObject) (apigen.CreateDeviceTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if !m.CanEdit() {
		return apigen.CreateDeviceTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgTemplateWrite}}, nil
	}
	b := req.Body
	if b == nil {
		return apigen.CreateDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateTemplate(b.Name, b.Type, b.Vendor, b.Model, b.PartNumber, b.Notes, b.UHeight, b.Ports)
	if msg != "" {
		return apigen.CreateDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	var (
		created   store.DeviceTemplate
		duplicate bool
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		created, err = q.CreateDeviceTemplate(ctx, store.CreateDeviceTemplateParams{
			OrganizationID: m.OrgID, Name: f.name, Type: f.typ, Vendor: f.vendor, Model: f.model, PartNumber: f.partNumber,
			UHeight: f.uHeight, Ports: f.ports, Notes: f.notes,
		})
		if isUniqueViolation(err) {
			duplicate = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create template: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "template.create", ObjectType: "device_template",
			ObjectID: uuidStr(created.ID), After: snapTemplate(created), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case duplicate:
		return apigen.CreateDeviceTemplate409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Tên template đã tồn tại"}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateDeviceTemplate201JSONResponse(toTemplate(created)), nil
}

func (s *Server) UpdateDeviceTemplate(ctx context.Context, req apigen.UpdateDeviceTemplateRequestObject) (apigen.UpdateDeviceTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateTemplate(b.Name, b.Type, b.Vendor, b.Model, b.PartNumber, b.Notes, b.UHeight, b.Ports)
	var (
		updated             store.DeviceTemplate
		notFound, forbidden bool
		conflict            string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetDeviceTemplate(ctx, store.GetDeviceTemplateParams{ID: pgUUID(req.TemplateId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load template: %w", err)
		}
		if !m.CanEdit() {
			forbidden = true
			return errRollback
		}
		if msg != "" {
			return errRollback
		}
		updated, err = q.UpdateDeviceTemplate(ctx, store.UpdateDeviceTemplateParams{
			ID: before.ID, OrganizationID: m.OrgID, Version: b.Version, Name: f.name, Type: f.typ, Vendor: f.vendor,
			Model: f.model, PartNumber: f.partNumber, UHeight: f.uHeight, Ports: f.ports, Notes: f.notes,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			conflict = msgStale
			return errRollback
		case isUniqueViolation(err):
			conflict = "Tên template đã tồn tại"
			return errRollback
		case err != nil:
			return fmt.Errorf("update template: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "template.update", ObjectType: "device_template",
			ObjectID: uuidStr(before.ID), Before: snapTemplate(before), After: snapTemplate(updated), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.UpdateDeviceTemplate404JSONResponse{NotFoundJSONResponse: notFoundBody(msgTemplateNotFound)}, nil
	case forbidden:
		return apigen.UpdateDeviceTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgTemplateWrite}}, nil
	case msg != "":
		return apigen.UpdateDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	case conflict != "":
		return apigen.UpdateDeviceTemplate409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: conflict}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateDeviceTemplate200JSONResponse(toTemplate(updated)), nil
}

func (s *Server) DeleteDeviceTemplate(ctx context.Context, req apigen.DeleteDeviceTemplateRequestObject) (apigen.DeleteDeviceTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var notFound, forbidden bool
	err = s.withTx(ctx, func(q store.Querier) error {
		before, err := q.GetDeviceTemplate(ctx, store.GetDeviceTemplateParams{ID: pgUUID(req.TemplateId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			notFound = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load template: %w", err)
		}
		if !m.CanEdit() {
			forbidden = true
			return errRollback
		}
		if _, err := q.DeleteDeviceTemplate(ctx, store.DeleteDeviceTemplateParams{ID: before.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("delete template: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{
			OrganizationID: m.OrgID, Actor: m.UserID, Action: "template.delete", ObjectType: "device_template",
			ObjectID: uuidStr(before.ID), Before: snapTemplate(before), Meta: infoFrom(ctx).meta,
		})
	})
	switch {
	case notFound:
		return apigen.DeleteDeviceTemplate404JSONResponse{NotFoundJSONResponse: notFoundBody(msgTemplateNotFound)}, nil
	case forbidden:
		return apigen.DeleteDeviceTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgTemplateWrite}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteDeviceTemplate204Response{}, nil
}

// --- device-scoped access ---

// editableDevice loads the device for an interface / IP write: 404 when not visible, 403 below edit.
func editableDevice(ctx context.Context, q store.Querier, m tenant.Membership, id uuid.UUID) (store.GetDeviceRow, int, error) {
	d, ok, err := loadDevice(ctx, q, m, id)
	if err != nil {
		return d, 0, err
	}
	if !ok {
		return d, 404, nil
	}
	level, err := deviceLevel(ctx, q, m, d)
	if err != nil {
		return d, 0, err
	}
	if level < tenant.LevelEdit {
		return d, 403, nil
	}
	return d, 0, nil
}

// --- interfaces ---

type ifaceFields struct {
	name, kind, media, speed, duplex, mode, allowed, description string
	accessVlan, nativeVlan                                       pgtype.Int4
	poe, adminUp                                                 bool
	lag                                                          *uuid.UUID
	mac                                                          net.HardwareAddr
	vlanTag                                                      pgtype.Int4
}

func vlanOK(v *int32) bool { return v == nil || (*v >= 1 && *v <= 4094) }

func validateInterface(name string, kind apigen.InterfaceKind, media *apigen.InterfaceMedia, speed *string, duplex *string,
	mode *apigen.InterfaceMode, access, native *int32, allowed *string, poe *bool, lag *uuid.UUID, description *string, adminUp *bool,
	mac *string, vlanTag *int32) (ifaceFields, string) {
	f := ifaceFields{
		name: strings.TrimSpace(name), kind: string(kind), speed: strings.TrimSpace(str(speed)), duplex: "auto",
		allowed: strings.ReplaceAll(str(allowed), " ", ""), description: str(description), adminUp: true, lag: lag,
		poe: poe != nil && *poe,
	}
	if media != nil {
		f.media = string(*media)
	}
	if mode != nil {
		f.mode = string(*mode)
	}
	if duplex != nil {
		f.duplex = *duplex
	}
	if adminUp != nil {
		f.adminUp = *adminUp
	}
	if access != nil {
		f.accessVlan = pgtype.Int4{Int32: *access, Valid: true}
	}
	if native != nil {
		f.nativeVlan = pgtype.Int4{Int32: *native, Valid: true}
	}
	if mac != nil && strings.TrimSpace(*mac) != "" {
		hw, err := net.ParseMAC(strings.TrimSpace(*mac))
		if err != nil || len(hw) != 6 {
			return f, "MAC không hợp lệ, vd aa:bb:cc:dd:ee:ff hoặc aabb.ccdd.eeff"
		}
		f.mac = hw
	}
	if vlanTag != nil {
		if *vlanTag < 1 || *vlanTag > 4094 {
			return f, "VLAN tag từ 1 đến 4094"
		}
		if kind != apigen.InterfaceKindSubinterface {
			return f, "VLAN tag (802.1Q) chỉ dùng cho sub-interface"
		}
		f.vlanTag = pgtype.Int4{Int32: *vlanTag, Valid: true}
	}
	switch {
	case f.name == "" || tooLong(f.name, 64):
		return f, "Tên interface bắt buộc, tối đa 64 ký tự"
	case !kind.Valid():
		return f, "Loại interface không hợp lệ"
	case media != nil && !media.Valid():
		return f, "Loại media không hợp lệ"
	case mode != nil && !mode.Valid():
		return f, "Mode không hợp lệ"
	case f.duplex != "auto" && f.duplex != "full" && f.duplex != "half":
		return f, "Duplex không hợp lệ"
	case !vlanOK(access) || !vlanOK(native):
		return f, "VLAN từ 1 đến 4094"
	case tooLong(f.speed, 20) || tooLong(f.description, 200) || tooLong(f.allowed, 500):
		return f, "Một trường vượt quá độ dài cho phép"
	case !vlanListRe.MatchString(f.allowed):
		return f, "Danh sách VLAN dạng 10,20-30"
	case lag != nil && f.kind == "lag":
		return f, "LAG không thể là thành viên của LAG khác"
	}
	for _, part := range strings.Split(f.allowed, ",") {
		for _, n := range strings.Split(part, "-") {
			if v, err := strconv.Atoi(n); part != "" && (err != nil || v < 1 || v > 4094) {
				return f, "VLAN từ 1 đến 4094"
			}
		}
	}
	return f, ""
}

type ifaceSnapshot struct {
	Interface   string `json:"interface"`
	Kind        string `json:"kind"`
	Media       string `json:"media,omitempty"`
	Speed       string `json:"speed,omitempty"`
	Mode        string `json:"mode,omitempty"`
	AccessVlan  int32  `json:"accessVlan,omitempty"`
	NativeVlan  int32  `json:"nativeVlan,omitempty"`
	Allowed     string `json:"allowedVlans,omitempty"`
	Poe         bool   `json:"poe,omitempty"`
	Description string `json:"description,omitempty"`
	AdminUp     bool   `json:"adminUp"`
	Mac         string `json:"mac,omitempty"`
	VlanTag     int32  `json:"vlanTag,omitempty"`
}

func snapInterface(i store.Interface) ifaceSnapshot {
	return ifaceSnapshot{i.Name, i.Kind, i.Media, i.Speed, i.Mode, i.AccessVlan.Int32, i.NativeVlan.Int32, i.AllowedVlans, i.Poe, i.Description, i.AdminUp, macString(i.Mac), i.VlanTag.Int32}
}

func optInt(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	n := v.Int32
	return &n
}

func toInterface(i store.Interface, lagName string, mgmt pgtype.UUID) apigen.Interface {
	return apigen.Interface{
		Id: uuid.UUID(i.ID.Bytes), Name: i.Name, Kind: apigen.InterfaceKind(i.Kind), Media: apigen.InterfaceMedia(i.Media),
		Speed: i.Speed, Duplex: apigen.InterfaceDuplex(i.Duplex), Mode: apigen.InterfaceMode(i.Mode), AccessVlan: optInt(i.AccessVlan),
		NativeVlan: optInt(i.NativeVlan), AllowedVlans: i.AllowedVlans, Poe: i.Poe, LagId: optUUID(i.LagID), LagName: lagName,
		Description: i.Description, AdminUp: i.AdminUp, SortOrder: i.SortOrder, IsManagement: mgmt.Valid && mgmt == i.ID,
		Mac: optMac(i.Mac), VlanTag: optInt(i.VlanTag),
		Version: i.Version,
	}
}

// checkLag: the parent must be a LAG of the same device and not the interface itself. Message = 400.
func checkLag(ctx context.Context, q store.Querier, m tenant.Membership, device, self pgtype.UUID, lag *uuid.UUID) (pgtype.UUID, string, error) {
	if lag == nil {
		return pgtype.UUID{}, "", nil
	}
	parent, err := q.GetInterface(ctx, store.GetInterfaceParams{ID: pgUUID(*lag), OrganizationID: m.OrgID, DeviceID: device})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (parent.Kind != "lag" || parent.ID == self)) {
		return pgtype.UUID{}, "LAG cha phải là interface loại LAG của cùng thiết bị", nil
	}
	if err != nil {
		return pgtype.UUID{}, "", fmt.Errorf("load lag: %w", err)
	}
	return parent.ID, "", nil
}

func (s *Server) ListInterfaces(ctx context.Context, req apigen.ListInterfacesRequestObject) (apigen.ListInterfacesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := loadDevice(ctx, s.q, m, req.DeviceId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.ListInterfaces404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	}
	rows, err := s.q.ListInterfaces(ctx, store.ListInterfacesParams{OrganizationID: m.OrgID, DeviceID: d.ID})
	if err != nil {
		return nil, fmt.Errorf("list interfaces: %w", err)
	}
	out := apigen.InterfaceList{Interfaces: make([]apigen.Interface, 0, len(rows))}
	for _, r := range rows {
		i := store.Interface{
			ID: r.ID, OrganizationID: r.OrganizationID, DeviceID: r.DeviceID, Name: r.Name, Kind: r.Kind, Media: r.Media,
			Speed: r.Speed, Duplex: r.Duplex, Mode: r.Mode, AccessVlan: r.AccessVlan, NativeVlan: r.NativeVlan,
			AllowedVlans: r.AllowedVlans, Poe: r.Poe, LagID: r.LagID, Description: r.Description, AdminUp: r.AdminUp,
			SortOrder: r.SortOrder, Version: r.Version, Mac: r.Mac, VlanTag: r.VlanTag,
		}
		out.Interfaces = append(out.Interfaces, toInterface(i, r.LagName, d.MgmtInterfaceID))
	}
	return apigen.ListInterfaces200JSONResponse(out), nil
}

// ifaceOutcome is the user-facing result of an interface / IP write.
type writeOutcome struct {
	code int    // 404 device, 403, 0
	bad  string // 400
	gone bool   // item not found (404)
	conf string // 409
}

func (s *Server) CreateInterface(ctx context.Context, req apigen.CreateInterfaceRequestObject) (apigen.CreateInterfaceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateInterface400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var duplex *string
	if b.Duplex != nil {
		v := string(*b.Duplex)
		duplex = &v
	}
	f, msg := validateInterface(b.Name, b.Kind, b.Media, b.Speed, duplex, b.Mode, b.AccessVlan, b.NativeVlan, b.AllowedVlans, b.Poe, b.LagId, b.Description, b.AdminUp, b.Mac, b.VlanTag)
	var (
		out     writeOutcome
		created store.Interface
		dev     store.GetDeviceRow
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var err error
		if dev, out.code, err = editableDevice(ctx, q, m, req.DeviceId); err != nil || out.code != 0 {
			return orRollback(err)
		}
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		lag, bad, err := checkLag(ctx, q, m, dev.ID, pgtype.UUID{}, f.lag)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		sort, err := q.MaxInterfaceSort(ctx, store.MaxInterfaceSortParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
		if err != nil {
			return fmt.Errorf("interface sort: %w", err)
		}
		created, err = q.CreateInterface(ctx, store.CreateInterfaceParams{
			OrganizationID: m.OrgID, DeviceID: dev.ID, Name: f.name, Kind: f.kind, Media: f.media, Speed: f.speed, Duplex: f.duplex,
			Mode: f.mode, AccessVlan: f.accessVlan, NativeVlan: f.nativeVlan, AllowedVlans: f.allowed, Poe: f.poe, LagID: lag,
			Description: f.description, AdminUp: f.adminUp, SortOrder: sort + 1, Mac: f.mac, VlanTag: f.vlanTag,
		})
		if isUniqueViolation(err) {
			out.conf = "Thiết bị đã có interface tên này"
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create interface: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "interface.create", nil, snapInterface(created))
	})
	switch {
	case out.code == 404:
		return apigen.CreateInterface404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.CreateInterface403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.CreateInterface400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.CreateInterface409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateInterface201JSONResponse(toInterface(created, "", dev.MgmtInterfaceID)), nil
}

// orRollback turns "no error but stop" into errRollback.
func orRollback(err error) error {
	if err != nil {
		return err
	}
	return errRollback
}

// deviceAudit files an interface / IP change under the device (its history) and bumps the device version.
func deviceAudit(ctx context.Context, q store.Querier, m tenant.Membership, device pgtype.UUID, action string, before, after any) error {
	if err := q.TouchDevice(ctx, store.TouchDeviceParams{ID: device, OrganizationID: m.OrgID}); err != nil {
		return fmt.Errorf("touch device: %w", err)
	}
	return audit.Write(ctx, q, audit.Entry{
		OrganizationID: m.OrgID, Actor: m.UserID, Action: action, ObjectType: "device", ObjectID: uuidStr(device),
		Before: before, After: after, Meta: infoFrom(ctx).meta,
	})
}

func (s *Server) UpdateInterface(ctx context.Context, req apigen.UpdateInterfaceRequestObject) (apigen.UpdateInterfaceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateInterface400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var duplex *string
	if b.Duplex != nil {
		v := string(*b.Duplex)
		duplex = &v
	}
	f, msg := validateInterface(b.Name, b.Kind, b.Media, b.Speed, duplex, b.Mode, b.AccessVlan, b.NativeVlan, b.AllowedVlans, b.Poe, b.LagId, b.Description, b.AdminUp, b.Mac, b.VlanTag)
	var (
		out     writeOutcome
		updated store.Interface
		dev     store.GetDeviceRow
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		var err error
		if dev, out.code, err = editableDevice(ctx, q, m, req.DeviceId); err != nil || out.code != 0 {
			return orRollback(err)
		}
		before, err := q.GetInterface(ctx, store.GetInterfaceParams{ID: pgUUID(req.InterfaceId), OrganizationID: m.OrgID, DeviceID: dev.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load interface: %w", err)
		}
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		lag, bad, err := checkLag(ctx, q, m, dev.ID, before.ID, f.lag)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		updated, err = q.UpdateInterface(ctx, store.UpdateInterfaceParams{
			ID: before.ID, OrganizationID: m.OrgID, DeviceID: dev.ID, Version: b.Version, Name: f.name, Kind: f.kind,
			Media: f.media, Speed: f.speed, Duplex: f.duplex, Mode: f.mode, AccessVlan: f.accessVlan, NativeVlan: f.nativeVlan,
			AllowedVlans: f.allowed, Poe: f.poe, LagID: lag, Description: f.description, AdminUp: f.adminUp,
			Mac: f.mac, VlanTag: f.vlanTag,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			out.conf = msgStale
			return errRollback
		case isUniqueViolation(err):
			out.conf = "Thiết bị đã có interface tên này"
			return errRollback
		case err != nil:
			return fmt.Errorf("update interface: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "interface.update", snapInterface(before), snapInterface(updated))
	})
	switch {
	case out.code == 404:
		return apigen.UpdateInterface404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.UpdateInterface403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.UpdateInterface404JSONResponse{NotFoundJSONResponse: notFoundBody(msgInterfaceNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateInterface400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.UpdateInterface409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateInterface200JSONResponse(toInterface(updated, "", dev.MgmtInterfaceID)), nil
}

func (s *Server) DeleteInterface(ctx context.Context, req apigen.DeleteInterfaceRequestObject) (apigen.DeleteInterfaceResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, code, err := editableDevice(ctx, q, m, req.DeviceId)
		if out.code = code; err != nil || code != 0 {
			return orRollback(err)
		}
		before, err := q.GetInterface(ctx, store.GetInterfaceParams{ID: pgUUID(req.InterfaceId), OrganizationID: m.OrgID, DeviceID: dev.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load interface: %w", err)
		}
		// Its IPs go with it (FK cascade); the device loses its management IP if this was the management interface.
		if _, err := q.DeleteInterface(ctx, store.DeleteInterfaceParams{ID: before.ID, OrganizationID: m.OrgID, DeviceID: dev.ID}); err != nil {
			return fmt.Errorf("delete interface: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "interface.delete", snapInterface(before), nil)
	})
	switch {
	case out.code == 404:
		return apigen.DeleteInterface404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteInterface403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.DeleteInterface404JSONResponse{NotFoundJSONResponse: notFoundBody(msgInterfaceNotFound)}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteInterface204Response{}, nil
}

func (s *Server) ApplyDeviceTemplate(ctx context.Context, req apigen.ApplyDeviceTemplateRequestObject) (apigen.ApplyDeviceTemplateResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.ApplyDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		out   writeOutcome
		added int64
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, code, err := editableDevice(ctx, q, m, req.DeviceId)
		if out.code = code; err != nil || code != 0 {
			return orRollback(err)
		}
		tpl, err := q.GetDeviceTemplate(ctx, store.GetDeviceTemplateParams{ID: pgUUID(req.Body.TemplateId), OrganizationID: m.OrgID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.bad = msgTemplateNotFound
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load template: %w", err)
		}
		// A stack member gets its own port numbers ({m}, ADR-027).
		if added, err = generatePorts(ctx, q, m, dev.ID, tpl, dev.ClusterMemberNo.Int32); err != nil {
			return err
		}
		return deviceAudit(ctx, q, m, dev.ID, "device.apply_template", nil, map[string]any{"template": tpl.Name, "addedPorts": added})
	})
	switch {
	case out.code == 404:
		return apigen.ApplyDeviceTemplate404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.ApplyDeviceTemplate403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.ApplyDeviceTemplate400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.ApplyDeviceTemplate200JSONResponse{Added: added}, nil
}

// --- IP addresses ---

// parseCIDR accepts "10.0.0.1/24" or a bare address (host prefix). The host bits are kept (it is an interface IP).
func parseCIDR(s string) (netip.Prefix, bool) {
	s = strings.TrimSpace(s)
	if p, err := netip.ParsePrefix(s); err == nil {
		return netip.PrefixFrom(p.Addr().Unmap(), p.Bits()), true
	}
	if a, err := netip.ParseAddr(s); err == nil && a.Zone() == "" {
		a = a.Unmap()
		return netip.PrefixFrom(a, a.BitLen()), true
	}
	return netip.Prefix{}, false
}

type ipFields struct {
	addr             netip.Prefix
	vrf, role, descr string
	iface            *uuid.UUID
}

func validateIP(address string, role apigen.IpRole, vrf, description *string, iface *uuid.UUID) (ipFields, string) {
	f := ipFields{role: string(role), vrf: strings.TrimSpace(str(vrf)), descr: str(description), iface: iface}
	var ok bool
	switch {
	case !role.Valid():
		return f, "Vai trò IP không hợp lệ"
	case tooLong(f.vrf, 64) || tooLong(f.descr, 200):
		return f, "Một trường vượt quá độ dài cho phép"
	case iface == nil && (f.role == "primary" || f.role == "secondary"):
		return f, "IP chính/phụ phải gắn với một interface (ADR-012)"
	}
	if f.addr, ok = parseCIDR(address); !ok {
		return f, "Địa chỉ IP không hợp lệ, vd 10.72.114.2/24"
	}
	return f, ""
}

type ipSnapshot struct {
	Address     string `json:"address"`
	Interface   string `json:"interface,omitempty"`
	Vrf         string `json:"vrf,omitempty"`
	Role        string `json:"role"`
	Description string `json:"description,omitempty"`
}

func toIP(ip store.IpAddress, ifaceName string) apigen.IpAddress {
	return apigen.IpAddress{
		Id: uuid.UUID(ip.ID.Bytes), InterfaceId: optUUID(ip.InterfaceID), InterfaceName: ifaceName, Address: ip.Address.String(),
		Vrf: ip.Vrf, Role: apigen.IpRole(ip.Role), Description: ip.Description, Version: ip.Version,
	}
}

// ipInterface checks the interface belongs to the device; returns its name.
func ipInterface(ctx context.Context, q store.Querier, m tenant.Membership, device pgtype.UUID, id *uuid.UUID) (pgtype.UUID, string, string, error) {
	if id == nil {
		return pgtype.UUID{}, "", "", nil
	}
	i, err := q.GetInterface(ctx, store.GetInterfaceParams{ID: pgUUID(*id), OrganizationID: m.OrgID, DeviceID: device})
	if errors.Is(err, pgx.ErrNoRows) {
		return pgtype.UUID{}, "", "Interface không thuộc thiết bị này", nil
	}
	if err != nil {
		return pgtype.UUID{}, "", "", fmt.Errorf("load interface: %w", err)
	}
	return i.ID, i.Name, "", nil
}

func ipConflict(err error) string {
	if isUniqueViolation(err) {
		return "Interface đã có IP chính cho họ địa chỉ này, hoặc IP đã gắn ở đây"
	}
	return ""
}

func (s *Server) ListDeviceIps(ctx context.Context, req apigen.ListDeviceIpsRequestObject) (apigen.ListDeviceIpsResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	d, ok, err := loadDevice(ctx, s.q, m, req.DeviceId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return apigen.ListDeviceIps404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	}
	rows, err := s.q.ListDeviceIPs(ctx, store.ListDeviceIPsParams{OrganizationID: m.OrgID, DeviceID: d.ID})
	if err != nil {
		return nil, fmt.Errorf("list ips: %w", err)
	}
	out := apigen.IpAddressList{Ips: make([]apigen.IpAddress, 0, len(rows))}
	for _, r := range rows {
		out.Ips = append(out.Ips, toIP(store.IpAddress{
			ID: r.ID, OrganizationID: r.OrganizationID, DeviceID: r.DeviceID, InterfaceID: r.InterfaceID, Address: r.Address,
			Vrf: r.Vrf, Role: r.Role, Description: r.Description, Version: r.Version,
		}, r.InterfaceName))
	}
	return apigen.ListDeviceIps200JSONResponse(out), nil
}

func (s *Server) CreateDeviceIp(ctx context.Context, req apigen.CreateDeviceIpRequestObject) (apigen.CreateDeviceIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.CreateDeviceIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateIP(b.Address, b.Role, b.Vrf, b.Description, b.InterfaceId)
	var (
		out     writeOutcome
		created store.IpAddress
		name    string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, code, err := editableDevice(ctx, q, m, req.DeviceId)
		if out.code = code; err != nil || code != 0 {
			return orRollback(err)
		}
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		iface, n, bad, err := ipInterface(ctx, q, m, dev.ID, f.iface)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		name = n
		created, err = q.CreateIP(ctx, store.CreateIPParams{
			OrganizationID: m.OrgID, DeviceID: dev.ID, InterfaceID: iface, Address: f.addr, Vrf: f.vrf, Role: f.role, Description: f.descr,
		})
		if out.conf = ipConflict(err); out.conf != "" {
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("create ip: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "ip.create", nil, ipSnapshot{f.addr.String(), name, f.vrf, f.role, f.descr})
	})
	switch {
	case out.code == 404:
		return apigen.CreateDeviceIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.CreateDeviceIp403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.bad != "":
		return apigen.CreateDeviceIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.CreateDeviceIp409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.CreateDeviceIp201JSONResponse(toIP(created, name)), nil
}

func (s *Server) UpdateDeviceIp(ctx context.Context, req apigen.UpdateDeviceIpRequestObject) (apigen.UpdateDeviceIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return apigen.UpdateDeviceIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	f, msg := validateIP(b.Address, b.Role, b.Vrf, b.Description, b.InterfaceId)
	var (
		out     writeOutcome
		updated store.IpAddress
		name    string
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, code, err := editableDevice(ctx, q, m, req.DeviceId)
		if out.code = code; err != nil || code != 0 {
			return orRollback(err)
		}
		before, err := q.GetIP(ctx, store.GetIPParams{ID: pgUUID(req.IpId), OrganizationID: m.OrgID, DeviceID: dev.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load ip: %w", err)
		}
		if msg != "" {
			out.bad = msg
			return errRollback
		}
		iface, n, bad, err := ipInterface(ctx, q, m, dev.ID, f.iface)
		if err != nil || bad != "" {
			out.bad = bad
			return orRollback(err)
		}
		name = n
		updated, err = q.UpdateIP(ctx, store.UpdateIPParams{
			ID: before.ID, OrganizationID: m.OrgID, DeviceID: dev.ID, Version: b.Version, InterfaceID: iface, Address: f.addr,
			Vrf: f.vrf, Role: f.role, Description: f.descr,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			out.conf = msgStale
			return errRollback
		}
		if out.conf = ipConflict(err); out.conf != "" {
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("update ip: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "ip.update",
			ipSnapshot{before.Address.String(), "", before.Vrf, before.Role, before.Description},
			ipSnapshot{f.addr.String(), name, f.vrf, f.role, f.descr})
	})
	switch {
	case out.code == 404:
		return apigen.UpdateDeviceIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.UpdateDeviceIp403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.UpdateDeviceIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgIPNotFound)}, nil
	case out.bad != "":
		return apigen.UpdateDeviceIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: out.bad}}, nil
	case out.conf != "":
		return apigen.UpdateDeviceIp409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: out.conf}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.UpdateDeviceIp200JSONResponse(toIP(updated, name)), nil
}

func (s *Server) DeleteDeviceIp(ctx context.Context, req apigen.DeleteDeviceIpRequestObject) (apigen.DeleteDeviceIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var out writeOutcome
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, code, err := editableDevice(ctx, q, m, req.DeviceId)
		if out.code = code; err != nil || code != 0 {
			return orRollback(err)
		}
		before, err := q.GetIP(ctx, store.GetIPParams{ID: pgUUID(req.IpId), OrganizationID: m.OrgID, DeviceID: dev.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			out.gone = true
			return errRollback
		}
		if err != nil {
			return fmt.Errorf("load ip: %w", err)
		}
		if _, err := q.DeleteIP(ctx, store.DeleteIPParams{ID: before.ID, OrganizationID: m.OrgID, DeviceID: dev.ID}); err != nil {
			return fmt.Errorf("delete ip: %w", err)
		}
		return deviceAudit(ctx, q, m, dev.ID, "ip.delete", ipSnapshot{before.Address.String(), "", before.Vrf, before.Role, before.Description}, nil)
	})
	switch {
	case out.code == 404:
		return apigen.DeleteDeviceIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case out.code == 403:
		return apigen.DeleteDeviceIp403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case out.gone:
		return apigen.DeleteDeviceIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgIPNotFound)}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DeleteDeviceIp204Response{}, nil
}

func macString(hw net.HardwareAddr) string {
	if len(hw) == 0 {
		return ""
	}
	return hw.String()
}

func optMac(hw net.HardwareAddr) *string {
	if len(hw) == 0 {
		return nil
	}
	v := hw.String()
	return &v
}
