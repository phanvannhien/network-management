package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Device import (P1-21, SRS §12). The client reads the spreadsheet, maps columns and values, proposes clusters, and
// sends rows in chunks. Every row goes through writeDevice (the device form's rules) inside its own savepoint, so a
// refused row is reported and the others go in; dryRun rolls the whole request back, which lets the preview see
// duplicates inside the file. Password columns never reach the server (the client drops them; vault is P2-02).

const maxImportRows = 500

func (s *Server) ImportDevices(ctx context.Context, req apigen.ImportDevicesRequestObject) (apigen.ImportDevicesResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	bad := func(msg string) (apigen.ImportDevicesResponseObject, error) {
		return apigen.ImportDevices400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	if !m.CanEdit() {
		return apigen.ImportDevices403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	b := req.Body
	switch {
	case b == nil || len(b.Rows) == 0:
		return bad("Không có dòng nào để nhập")
	case len(b.Rows) > maxImportRows || len(b.Clusters) > maxImportRows:
		return bad(fmt.Sprintf("Tối đa %d dòng mỗi lần gửi", maxImportRows))
	case !b.MatchBy.Valid():
		return bad("Cách khớp thiết bị không hợp lệ")
	}
	results, err := s.importDevices(ctx, m, *b)
	if err != nil {
		return nil, err
	}
	return apigen.ImportDevices200JSONResponse{Results: results}, nil
}

func (s *Server) importDevices(ctx context.Context, m tenant.Membership, b apigen.DeviceImport) ([]apigen.DeviceImportRowResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := store.New(tx)

	// Clusters first: created, or reused by name (a second chunk, or a re-import).
	type clusterRef struct {
		id     uuid.UUID
		failed string
	}
	clusters := map[string]clusterRef{}
	for _, c := range b.Clusters {
		ref, err := importCluster(ctx, tx, m, c)
		if err != nil {
			return nil, err
		}
		clusters[c.Key] = ref
	}

	results := make([]apigen.DeviceImportRowResult, 0, len(b.Rows))
	created, updated := 0, 0
	for _, r := range b.Rows {
		res := apigen.DeviceImportRowResult{Row: r.Row, Hostname: strings.TrimSpace(r.Device.Hostname), Warnings: []string{}}
		var cluster *uuid.UUID
		if r.ClusterKey != nil && *r.ClusterKey != "" {
			ref, ok := clusters[*r.ClusterKey]
			switch {
			case !ok:
				res.Action, res.Message = apigen.DeviceImportRowResultActionError, "Cụm của dòng này không có trong yêu cầu"
			case ref.failed != "":
				res.Action, res.Message = apigen.DeviceImportRowResultActionError, "Không tạo được cụm: "+ref.failed
			default:
				id := ref.id
				cluster = &id
			}
			if res.Action == apigen.DeviceImportRowResultActionError {
				results = append(results, res)
				continue
			}
		}
		sp, err := tx.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("savepoint: %w", err)
		}
		ok, err := importRow(ctx, store.New(sp), m, b.MatchBy, r, cluster, &res)
		if err != nil {
			_ = sp.Rollback(ctx)
			return nil, err
		}
		if !ok {
			if err := sp.Rollback(ctx); err != nil {
				return nil, fmt.Errorf("rollback row: %w", err)
			}
			res.Action = apigen.DeviceImportRowResultActionError
		} else {
			if err := sp.Commit(ctx); err != nil {
				return nil, fmt.Errorf("release row: %w", err)
			}
			if res.Action == apigen.DeviceImportRowResultActionCreate {
				created++
			} else {
				updated++
			}
		}
		results = append(results, res)
	}
	if b.DryRun {
		return results, nil
	}
	if err := audit.Write(ctx, q, audit.Entry{
		OrganizationID: m.OrgID, Actor: m.UserID, Action: "device.import", ObjectType: "device",
		After: map[string]any{"rows": len(b.Rows), "created": created, "updated": updated, "failed": len(b.Rows) - created - updated},
		Meta:  infoFrom(ctx).meta,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit import: %w", err)
	}
	return results, nil
}

// importCluster creates the proposed cluster, or reuses the one of that name in the same site.
func importCluster(ctx context.Context, tx pgx.Tx, m tenant.Membership, c apigen.DeviceImportCluster) (struct {
	id     uuid.UUID
	failed string
}, error) {
	type ref = struct {
		id     uuid.UUID
		failed string
	}
	q := store.New(tx)
	existing, err := q.ImportClusterByName(ctx, store.ImportClusterByNameParams{OrganizationID: m.OrgID, Name: strings.TrimSpace(c.Name)})
	switch {
	case err == nil && uuid.UUID(existing.SiteID.Bytes) == c.SiteId:
		return ref{id: uuid.UUID(existing.ID.Bytes)}, nil
	case err == nil:
		return ref{failed: fmt.Sprintf("tên cụm %s đã dùng ở site khác", c.Name)}, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return ref{}, fmt.Errorf("find cluster: %w", err)
	}
	var mgmt *string
	if c.MgmtIp != nil && strings.TrimSpace(*c.MgmtIp) != "" {
		p, ok := parseCIDR(*c.MgmtIp)
		if !ok {
			return ref{failed: "IP quản trị của cụm không hợp lệ"}, nil
		}
		p, _, err = withSubnetPrefix(ctx, q, m, p)
		if err != nil {
			return ref{}, err
		}
		v := p.String()
		mgmt = &v
	}
	f, msg := validateCluster(c.Kind, c.Name, c.Hostname, mgmt, nil, c.SiteId)
	if msg != "" {
		return ref{failed: msg}, nil
	}
	sp, err := tx.Begin(ctx)
	if err != nil {
		return ref{}, fmt.Errorf("savepoint: %w", err)
	}
	var out writeOutcome
	after, err := writeCluster(ctx, store.New(sp), m, f, nil, 0, &out)
	if err != nil && !errors.Is(err, errRollback) {
		_ = sp.Rollback(ctx)
		return ref{}, err
	}
	if errors.Is(err, errRollback) {
		_ = sp.Rollback(ctx)
		switch {
		case out.bad != "":
			return ref{failed: out.bad}, nil
		case out.conf != "":
			return ref{failed: out.conf}, nil
		default:
			return ref{failed: msgCannotEdit}, nil
		}
	}
	if err := sp.Commit(ctx); err != nil {
		return ref{}, fmt.Errorf("release cluster: %w", err)
	}
	return ref{id: uuid.UUID(after.ID.Bytes)}, nil
}

// withSubnetPrefix gives a bare address (stored as /32, /128) the prefix of the most specific IPAM subnet holding it.
func withSubnetPrefix(ctx context.Context, q store.Querier, m tenant.Membership, p netip.Prefix) (netip.Prefix, bool, error) {
	if p.Bits() != p.Addr().BitLen() {
		return p, true, nil
	}
	bits, err := q.ImportSubnetPrefix(ctx, store.ImportSubnetPrefixParams{OrganizationID: m.OrgID, Vrf: "", Ip: p.Addr()})
	if err != nil {
		return p, false, fmt.Errorf("subnet prefix: %w", err)
	}
	if bits == 0 {
		return p, false, nil
	}
	return netip.PrefixFrom(p.Addr(), int(bits)), true, nil
}

// importRow writes one row; false = refused (res.Message says why, the caller rolls the savepoint back).
func importRow(ctx context.Context, q store.Querier, m tenant.Membership, matchBy apigen.DeviceImportMatchBy, r apigen.DeviceImportRow,
	cluster *uuid.UUID, res *apigen.DeviceImportRowResult) (bool, error) {
	in := r.Device
	if cluster != nil {
		in.ClusterId = cluster
	}
	f, msg := validateDevice(bodyFromInput(in))
	if msg != "" {
		res.Message = msg
		return false, nil
	}
	// The device to update, if any.
	var found []pgtype.UUID
	var err error
	switch {
	case matchBy == apigen.DeviceImportMatchByHostname:
		found, err = q.ImportDevicesByHostname(ctx, store.ImportDevicesByHostnameParams{OrganizationID: m.OrgID, Hostname: f.hostname})
	case matchBy == apigen.DeviceImportMatchBySerial && f.serial != "":
		found, err = q.ImportDevicesBySerial(ctx, store.ImportDevicesBySerialParams{OrganizationID: m.OrgID, Serial: f.serial})
	}
	if err != nil {
		return false, fmt.Errorf("match device: %w", err)
	}
	if len(found) > 1 {
		res.Message = "Có nhiều thiết bị khớp — không biết cập nhật thiết bị nào"
		return false, nil
	}
	var id *uuid.UUID
	var version int32
	res.Action = apigen.DeviceImportRowResultActionCreate
	if len(found) == 1 {
		d, ok, err := loadDevice(ctx, q, m, uuid.UUID(found[0].Bytes))
		if err != nil {
			return false, err
		}
		if !ok {
			res.Message = msgDeviceNotFound
			return false, nil
		}
		f = overlayImport(fieldsFromDevice(d), f, in)
		did := uuid.UUID(d.ID.Bytes)
		id, version = &did, d.Version
		res.Action = apigen.DeviceImportRowResultActionUpdate
	}
	var out deviceOutcome
	if err := writeDevice(ctx, q, m, f, id, version, &out); err != nil && !errors.Is(err, errRollback) {
		return false, err
	}
	switch {
	case out.bad != "":
		res.Message = out.bad
		return false, nil
	case out.conflict != "":
		res.Message = out.conflict
		return false, nil
	case out.forbidden || out.notFound:
		res.Message = msgCannotEdit
		return false, nil
	}
	dev := out.device
	devID := uuid.UUID(dev.ID.Bytes)
	res.DeviceId = &devID
	if r.MgmtIp == nil || strings.TrimSpace(*r.MgmtIp) == "" || cluster != nil {
		return true, nil
	}
	return true, importMgmtIP(ctx, q, m, dev, *r.MgmtIp, str(r.MgmtInterface), res)
}

// importMgmtIP puts the management address on its interface (found by name, else created) and marks it as the
// management interface. Problems with the address are warnings: the device itself is in.
func importMgmtIP(ctx context.Context, q store.Querier, m tenant.Membership, dev store.GetDeviceRow, raw, ifName string, res *apigen.DeviceImportRowResult) error {
	addr, ok := parseCIDR(raw)
	if !ok {
		res.Warnings = append(res.Warnings, fmt.Sprintf("IP quản trị %q không hợp lệ — bỏ qua", raw))
		return nil
	}
	addr, known, err := withSubnetPrefix(ctx, q, m, addr)
	if err != nil {
		return err
	}
	if !known {
		res.Warnings = append(res.Warnings, fmt.Sprintf("Chưa có subnet IPAM chứa %s: lưu %s, nhớ sửa lại mask", addr.Addr(), addr))
	}
	has, err := q.ImportDeviceHasIP(ctx, store.ImportDeviceHasIPParams{OrganizationID: m.OrgID, DeviceID: dev.ID, Ip: addr.Addr()})
	if err != nil {
		return fmt.Errorf("device ip: %w", err)
	}
	if has > 0 {
		return nil // re-import: the address is there already
	}
	// Someone else's address (ADR-038): the device is imported, its management IP is not.
	if taken, err := addressTaken(ctx, q, m, addrClaim{host: addr.Addr(), role: "primary", device: dev.ID, cluster: dev.ClusterID,
		lifecycle: dev.Lifecycle}); err != nil {
		return err
	} else if taken != "" {
		res.Warnings = append(res.Warnings, taken+" — không gắn IP quản trị")
		return nil
	}
	name, kind := mgmtInterfaceFor(dev.Type, ifName)
	iface, err := q.ImportInterfaceByName(ctx, store.ImportInterfaceByNameParams{OrganizationID: m.OrgID, DeviceID: dev.ID, Name: name})
	if errors.Is(err, pgx.ErrNoRows) {
		sort, err := q.MaxInterfaceSort(ctx, store.MaxInterfaceSortParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
		if err != nil {
			return fmt.Errorf("interface sort: %w", err)
		}
		created, err := q.CreateInterface(ctx, store.CreateInterfaceParams{
			OrganizationID: m.OrgID, DeviceID: dev.ID, Name: name, Kind: kind, Duplex: "auto", AdminUp: true, SortOrder: sort + 1,
			Description: "Interface quản trị tạm (tạo khi nhập Excel) — đổi tên/loại cho đúng thiết bị",
		})
		if err != nil {
			return fmt.Errorf("create mgmt interface: %w", err)
		}
		if err := deviceAudit(ctx, q, m, dev.ID, "interface.create", nil, snapInterface(created)); err != nil {
			return err
		}
		iface = created.ID
	} else if err != nil {
		return fmt.Errorf("find mgmt interface: %w", err)
	}
	if _, err := q.CreateIP(ctx, store.CreateIPParams{
		OrganizationID: m.OrgID, DeviceID: dev.ID, InterfaceID: iface, Address: addr, Vrf: "", Role: "primary",
	}); isUniqueViolation(err) {
		res.Warnings = append(res.Warnings, fmt.Sprintf("Interface %s đã có IP chính — không thêm %s", name, addr))
		return nil
	} else if err != nil {
		return fmt.Errorf("create mgmt ip: %w", err)
	}
	if err := deviceAudit(ctx, q, m, dev.ID, "ip.create", nil, ipSnapshot{addr.String(), name, "", "primary", ""}); err != nil {
		return err
	}
	if !dev.MgmtInterfaceID.Valid {
		if err := q.SetDeviceMgmtInterface(ctx, store.SetDeviceMgmtInterfaceParams{InterfaceID: iface, ID: dev.ID, OrganizationID: m.OrgID}); err != nil {
			return fmt.Errorf("set mgmt interface: %w", err)
		}
		if err := deviceAudit(ctx, q, m, dev.ID, "device.update", map[string]string{"mgmtInterface": ""}, map[string]string{"mgmtInterface": name}); err != nil {
			return err
		}
	}
	return nil
}

// mgmtInterfaceFor: the named interface, else the usual place of a management address — VLAN 1 on a switch, "mgmt"
// elsewhere (a template port of that name is used when there is one). A new Vlan… is an SVI; anything else is created
// as a virtual placeholder (loopback kind) so no cable can be plugged into a port that may not exist.
func mgmtInterfaceFor(deviceType, name string) (string, string) {
	name = strings.TrimSpace(name)
	if name == "" {
		switch deviceType {
		case "l2_switch", "l3_switch", "poe_switch":
			name = "Vlan1"
		default:
			name = "mgmt"
		}
	}
	if strings.HasPrefix(strings.ToLower(name), "vlan") {
		return name, "svi"
	}
	return name, "loopback"
}

// fieldsFromDevice: a stored device as form fields (the base an import row overlays).
func fieldsFromDevice(d store.GetDeviceRow) deviceFields {
	custom := map[string]any{}
	_ = json.Unmarshal(d.CustomFields, &custom)
	f := deviceFields{
		hostname: d.Hostname, typ: d.Type, vendor: d.Vendor, model: d.Model, partNumber: d.PartNumber, serial: d.SerialNumber,
		assetTag: d.AssetTag, firmware: d.Firmware, role: d.Role, lifecycle: d.Lifecycle, owner: d.OwnerName, po: d.PoNumber,
		notes: d.Notes, managed: d.Managed, purchase: d.PurchaseDate, warranty: d.WarrantyEnd, license: d.LicenseEnd,
		eol: d.EolDate, eos: d.EosDate, tags: d.Tags, custom: custom, site: uuid.UUID(d.SiteID.Bytes),
		location: ptrUUID(d.LocationID), rack: ptrUUID(d.RackID), rackU: d.RackU, uHeight: d.UHeight, uHeightSet: true,
		mgmt: ptrUUID(d.MgmtInterfaceID), poll: d.PollAddress, cluster: ptrUUID(d.ClusterID), clusterRole: d.ClusterRole,
		clusterNo: d.ClusterMemberNo,
	}
	return f
}

// overlayImport: what the spreadsheet says wins; what it leaves empty keeps the stored value.
func overlayImport(base, row deviceFields, in apigen.DeviceInput) deviceFields {
	base.hostname, base.typ, base.site = row.hostname, row.typ, row.site
	if in.LocationId != nil {
		base.location = row.location
	}
	for _, p := range []struct {
		dst *string
		v   string
	}{
		{&base.vendor, row.vendor}, {&base.model, row.model}, {&base.partNumber, row.partNumber}, {&base.serial, row.serial},
		{&base.assetTag, row.assetTag}, {&base.firmware, row.firmware}, {&base.owner, row.owner}, {&base.notes, row.notes},
	} {
		if p.v != "" {
			*p.dst = p.v
		}
	}
	if in.Role != nil {
		base.role = row.role
	}
	if in.Lifecycle != nil {
		base.lifecycle = row.lifecycle
	}
	if in.ClusterId != nil {
		base.cluster, base.clusterRole, base.clusterNo = row.cluster, row.clusterRole, row.clusterNo
	}
	return base
}

func ptrUUID(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := uuid.UUID(u.Bytes)
	return &id
}

// SetDeviceMgmtIp sets the management address from the property panel in one step (ADR-034: written right away).
func (s *Server) SetDeviceMgmtIp(ctx context.Context, req apigen.SetDeviceMgmtIpRequestObject) (apigen.SetDeviceMgmtIpResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.SetDeviceMgmtIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu dữ liệu"}}, nil
	}
	var (
		code int
		bad  string
		out  apigen.MgmtIpResult
	)
	err = s.withTx(ctx, func(q store.Querier) error {
		dev, c, err := editableDevice(ctx, q, m, req.DeviceId)
		if code = c; err != nil || c != 0 {
			return orRollback(err)
		}
		addr, ok := parseCIDR(req.Body.Address)
		if !ok {
			bad = "Địa chỉ IP không hợp lệ, vd 192.168.1.1 hoặc 192.168.1.1/24"
			return errRollback
		}
		out.Warnings = []string{}
		addr, known, err := withSubnetPrefix(ctx, q, m, addr)
		if err != nil {
			return err
		}
		if !known {
			out.Warnings = append(out.Warnings, fmt.Sprintf("Chưa có subnet IPAM chứa %s: lưu %s, nhớ sửa lại mask", addr.Addr(), addr))
		}
		if bad, err = addressTaken(ctx, q, m, addrClaim{host: addr.Addr(), role: "primary", device: dev.ID, cluster: dev.ClusterID,
			lifecycle: dev.Lifecycle}); err != nil || bad != "" {
			return orRollback(err)
		}
		// The management interface, else the usual one for the kind of device (found by name or created).
		iface := dev.MgmtInterfaceID
		name := dev.MgmtInterfaceName
		if !iface.Valid {
			n, kind := mgmtInterfaceFor(dev.Type, "")
			name = n
			found, err := q.ImportInterfaceByName(ctx, store.ImportInterfaceByNameParams{OrganizationID: m.OrgID, DeviceID: dev.ID, Name: n})
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				sort, err := q.MaxInterfaceSort(ctx, store.MaxInterfaceSortParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
				if err != nil {
					return fmt.Errorf("interface sort: %w", err)
				}
				created, err := q.CreateInterface(ctx, store.CreateInterfaceParams{
					OrganizationID: m.OrgID, DeviceID: dev.ID, Name: n, Kind: kind, Duplex: "auto", AdminUp: true, SortOrder: sort + 1,
					Description: "Interface quản trị",
				})
				if err != nil {
					return fmt.Errorf("create mgmt interface: %w", err)
				}
				found = created.ID
				if err := deviceAudit(ctx, q, m, dev.ID, "interface.create", nil, map[string]string{"name": n, "kind": kind}); err != nil {
					return err
				}
			case err != nil:
				return fmt.Errorf("find mgmt interface: %w", err)
			}
			iface = found
			if err := q.SetDeviceMgmtInterface(ctx, store.SetDeviceMgmtInterfaceParams{InterfaceID: iface, ID: dev.ID, OrganizationID: m.OrgID}); err != nil {
				return fmt.Errorf("set mgmt interface: %w", err)
			}
			if err := deviceAudit(ctx, q, m, dev.ID, "device.update", map[string]string{"mgmtInterface": ""}, map[string]string{"mgmtInterface": n}); err != nil {
				return err
			}
		}
		// Replace the primary address of that family on the interface, or add one.
		ips, err := q.ListDeviceIPs(ctx, store.ListDeviceIPsParams{OrganizationID: m.OrgID, DeviceID: dev.ID})
		if err != nil {
			return fmt.Errorf("device ips: %w", err)
		}
		for _, ip := range ips {
			if ip.InterfaceID == iface && ip.Role == "primary" && ip.Address.Addr().Is4() == addr.Addr().Is4() {
				if ip.Address == addr {
					out.MgmtIp, out.InterfaceName = addr.String(), name
					return nil
				}
				if _, err := q.UpdateIP(ctx, store.UpdateIPParams{
					InterfaceID: iface, Address: addr, Vrf: ip.Vrf, Role: "primary", Description: ip.Description,
					ID: ip.ID, OrganizationID: m.OrgID, DeviceID: dev.ID, Version: ip.Version,
				}); err != nil {
					return fmt.Errorf("update mgmt ip: %w", err)
				}
				out.MgmtIp, out.InterfaceName = addr.String(), name
				return deviceAudit(ctx, q, m, dev.ID, "ip.update", ipSnapshot{ip.Address.String(), name, ip.Vrf, "primary", ""}, ipSnapshot{addr.String(), name, ip.Vrf, "primary", ""})
			}
		}
		if _, err := q.CreateIP(ctx, store.CreateIPParams{
			OrganizationID: m.OrgID, DeviceID: dev.ID, InterfaceID: iface, Address: addr, Vrf: "", Role: "primary",
		}); isUniqueViolation(err) {
			bad = fmt.Sprintf("Interface %s đã có địa chỉ này", name)
			return errRollback
		} else if err != nil {
			return fmt.Errorf("create mgmt ip: %w", err)
		}
		out.MgmtIp, out.InterfaceName = addr.String(), name
		return deviceAudit(ctx, q, m, dev.ID, "ip.create", nil, ipSnapshot{addr.String(), name, "", "primary", ""})
	})
	switch {
	case err != nil:
		return nil, err
	case code == 404:
		return apigen.SetDeviceMgmtIp404JSONResponse{NotFoundJSONResponse: notFoundBody(msgDeviceNotFound)}, nil
	case code == 403:
		return apigen.SetDeviceMgmtIp403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	case bad != "":
		return apigen.SetDeviceMgmtIp400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	}
	return apigen.SetDeviceMgmtIp200JSONResponse(out), nil
}
