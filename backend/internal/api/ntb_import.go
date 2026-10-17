package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/audit"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/ntbschema"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// .ntb.json import (P1-22, ADR-037): a new diagram with the file's objects, in one transaction. Ids are always new;
// the file's sites are placed on sites the user picks; a device whose hostname is already in the target site is
// reused (default), updated, created anyway (refused if the name is taken) or skipped. The organization comes from the
// route — nothing in the file can point elsewhere. Every object written goes through the same writer (rules + audit)
// as the forms.

// parseNtb checks the document against schema/ntb.schema.json and decodes it.
func parseNtb(doc map[string]interface{}) (ntbFile, string) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return ntbFile{}, "File không đọc được"
	}
	if err := ntbschema.Validate(raw); err != nil {
		msg := err.Error()
		if len(msg) > 600 {
			msg = msg[:600] + "…"
		}
		return ntbFile{}, "File .ntb.json không đúng định dạng: " + msg
	}
	var f ntbFile
	if err := json.Unmarshal(raw, &f); err != nil {
		return ntbFile{}, "File không đọc được: " + err.Error()
	}
	return f, ""
}

func (s *Server) PreviewNtbImport(ctx context.Context, req apigen.PreviewNtbImportRequestObject) (apigen.PreviewNtbImportResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return apigen.PreviewNtbImport400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Thiếu file"}}, nil
	}
	f, bad := parseNtb(req.Body.File)
	if bad != "" {
		return apigen.PreviewNtbImport400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: bad}}, nil
	}
	type siteRow struct {
		Ref    string     `json:"ref"`
		Code   string     `json:"code"`
		Name   string     `json:"name"`
		SiteID *uuid.UUID `json:"siteId,omitempty"`
	}
	type deviceRow struct {
		Ref        string     `json:"ref"`
		Hostname   string     `json:"hostname"`
		SiteRef    string     `json:"siteRef"`
		ExistingID *uuid.UUID `json:"existingId,omitempty"`
	}
	preview := struct {
		DiagramName string         `json:"diagramName"`
		Sites       []siteRow      `json:"sites"`
		Devices     []deviceRow    `json:"devices"`
		Counts      map[string]int `json:"counts"`
	}{DiagramName: f.Diagram.Name, Sites: []siteRow{}, Devices: []deviceRow{}, Counts: map[string]int{
		"devices": len(f.Devices), "links": len(f.Links), "endpointGroups": len(f.EndpointGroups), "clusters": len(f.Clusters)}}
	target := map[string]pgtype.UUID{}
	for _, site := range f.Sites {
		row := siteRow{Ref: site.Ref, Code: site.Code, Name: site.Name}
		id, err := s.q.NtbSiteMatch(ctx, store.NtbSiteMatchParams{OrganizationID: m.OrgID, Code: site.Code, Name: site.Name})
		if err == nil {
			u := uuid.UUID(id.Bytes)
			row.SiteID = &u
			target[site.Ref] = id
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("match site: %w", err)
		}
		preview.Sites = append(preview.Sites, row)
	}
	for _, d := range f.Devices {
		row := deviceRow{Ref: d.Ref, Hostname: d.Hostname, SiteRef: d.SiteRef}
		if site, ok := target[d.SiteRef]; ok {
			member := pgtype.Int4{}
			if d.ClusterMemberNo != nil {
				member = pgtype.Int4{Int32: *d.ClusterMemberNo, Valid: true}
			}
			id, err := s.q.NtbDeviceInSite(ctx, store.NtbDeviceInSiteParams{OrganizationID: m.OrgID, SiteID: site, Hostname: d.Hostname, MemberNo: member})
			if err == nil {
				u := uuid.UUID(id.Bytes)
				row.ExistingID = &u
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("match device: %w", err)
			}
		}
		preview.Devices = append(preview.Devices, row)
	}
	var out apigen.NtbPreview
	raw, err := json.Marshal(preview)
	if err != nil {
		return nil, fmt.Errorf("encode preview: %w", err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode preview: %w", err)
	}
	return apigen.PreviewNtbImport200JSONResponse(out), nil
}

type ntbImporter struct {
	ctx      context.Context
	tx       pgx.Tx
	q        store.Querier
	m        tenant.Membership
	sites    map[string]pgtype.UUID
	devices  map[string]pgtype.UUID
	ifaces   map[string]pgtype.UUID
	groups   map[string]pgtype.UUID
	clusters map[string]pgtype.UUID
	links    map[string]pgtype.UUID
	result   apigen.NtbImportResult
}

func (im *ntbImporter) warn(format string, a ...any) {
	if len(im.result.Warnings) < 200 {
		im.result.Warnings = append(im.result.Warnings, fmt.Sprintf(format, a...))
	}
}

// savepoint runs fn in a savepoint: a database refusal (unique violation…) rolls back fn only.
func (im *ntbImporter) savepoint(fn func(q store.Querier) error) (bool, error) {
	sp, err := im.tx.Begin(im.ctx)
	if err != nil {
		return false, fmt.Errorf("savepoint: %w", err)
	}
	if err := fn(store.New(sp)); err != nil {
		_ = sp.Rollback(im.ctx)
		if errors.Is(err, errRollback) || isUniqueViolation(err) {
			return false, nil
		}
		return false, err
	}
	return true, sp.Commit(im.ctx)
}

func (s *Server) ImportNtb(ctx context.Context, req apigen.ImportNtbRequestObject) (apigen.ImportNtbResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	bad := func(msg string) (apigen.ImportNtbResponseObject, error) {
		return apigen.ImportNtb400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: msg}}, nil
	}
	if !m.CanEdit() {
		return apigen.ImportNtb403JSONResponse{ForbiddenJSONResponse: apigen.ForbiddenJSONResponse{Message: msgCannotEdit}}, nil
	}
	b := req.Body
	if b == nil {
		return bad("Thiếu file")
	}
	f, msg := parseNtb(b.File)
	if msg != "" {
		return bad(msg)
	}
	name := strings.TrimSpace(b.DiagramName)
	if name == "" {
		name = f.Diagram.Name
	}
	if tooLong(name, 120) {
		return bad("Tên sơ đồ tối đa 120 ký tự")
	}
	// Every site a used object sits in needs a target.
	sites := map[string]pgtype.UUID{}
	for ref, id := range b.SiteMap {
		sites[ref] = pgUUID(id)
	}
	for _, need := range usedSiteRefs(f) {
		if _, ok := sites[need]; !ok {
			code := need
			for _, s := range f.Sites {
				if s.Ref == need {
					code = s.Code
				}
			}
			return bad(fmt.Sprintf("Chọn site đích cho %s", code))
		}
	}
	existing, err := s.q.ListDiagrams(ctx, store.ListDiagramsParams{OrganizationID: m.OrgID})
	if err != nil {
		return nil, fmt.Errorf("list diagrams: %w", err)
	}
	for _, d := range existing {
		if strings.EqualFold(d.Name, name) {
			return apigen.ImportNtb409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: fmt.Sprintf("Đã có sơ đồ tên %s — đặt tên khác", name)}}, nil
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	im := &ntbImporter{ctx: ctx, tx: tx, q: store.New(tx), m: m, sites: sites,
		devices: map[string]pgtype.UUID{}, ifaces: map[string]pgtype.UUID{}, groups: map[string]pgtype.UUID{},
		clusters: map[string]pgtype.UUID{}, links: map[string]pgtype.UUID{}}
	im.result.Warnings = []string{}
	steps := []func(apigen.NtbImport, ntbFile) (string, error){im.importClusters, im.importDevices, im.importGroups, im.importLinks}
	for _, step := range steps {
		msg, err := step(*b, f)
		if err != nil {
			return nil, err
		}
		if msg != "" {
			return bad(msg)
		}
	}
	diagramID, err := im.importDiagram(name, f)
	if err != nil {
		return nil, err
	}
	im.result.DiagramId = uuid.UUID(diagramID.Bytes)
	if err := audit.Write(ctx, im.q, audit.Entry{OrganizationID: m.OrgID, Actor: m.UserID, Action: "import.ntb", ObjectType: "diagram",
		ObjectID: uuidStr(diagramID), After: map[string]any{"name": name, "created": im.result.Created, "reused": im.result.Reused,
			"warnings": len(im.result.Warnings)}, Meta: infoFrom(ctx).meta}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit import: %w", err)
	}
	return apigen.ImportNtb200JSONResponse(im.result), nil
}

// usedSiteRefs: the sites the file's objects sit in (clusters, devices, groups, frames).
func usedSiteRefs(f ntbFile) []string {
	seen := map[string]bool{}
	var out []string
	add := func(ref string) {
		if ref != "" && !seen[ref] {
			seen[ref] = true
			out = append(out, ref)
		}
	}
	for _, c := range f.Clusters {
		add(c.SiteRef)
	}
	for _, d := range f.Devices {
		add(d.SiteRef)
	}
	for _, g := range f.EndpointGroups {
		add(g.SiteRef)
	}
	return out
}

func (im *ntbImporter) importClusters(_ apigen.NtbImport, f ntbFile) (string, error) {
	for _, c := range f.Clusters {
		site := im.sites[c.SiteRef]
		found, err := im.q.ImportClusterByName(im.ctx, store.ImportClusterByNameParams{OrganizationID: im.m.OrgID, Name: c.Name})
		if err == nil {
			if found.SiteID != site {
				return fmt.Sprintf("Tên cụm %s đã dùng ở site khác trong tổ chức", c.Name), nil
			}
			im.clusters[c.Ref] = found.ID
			im.result.Reused++
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find cluster: %w", err)
		}
		var mgmt *string
		if c.MgmtIP != "" {
			mgmt = &c.MgmtIP
		}
		fields, msg := validateCluster(apigen.ClusterKind(c.Kind), c.Name, &c.Hostname, mgmt, &c.Notes, uuid.UUID(site.Bytes))
		if msg != "" {
			return fmt.Sprintf("Cụm %s: %s", c.Name, msg), nil
		}
		var out writeOutcome
		row, err := writeCluster(im.ctx, im.q, im.m, fields, nil, 0, &out)
		if errors.Is(err, errRollback) {
			return fmt.Sprintf("Cụm %s: %s", c.Name, firstNonEmpty(out.bad, out.conf, msgCannotEdit)), nil
		}
		if err != nil {
			return "", err
		}
		im.clusters[c.Ref] = row.ID
		im.result.Created.Clusters++
	}
	return "", nil
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}

func (im *ntbImporter) importDevices(b apigen.NtbImport, f ntbFile) (string, error) {
	ifacesOf := map[string][]ntbInterface{}
	for _, i := range f.Interfaces {
		ifacesOf[i.DeviceRef] = append(ifacesOf[i.DeviceRef], i)
	}
	ipsOf := map[string][]ntbIP{}
	for _, ip := range f.IPs {
		ipsOf[ip.DeviceRef] = append(ipsOf[ip.DeviceRef], ip)
	}
	createdHere := map[pgtype.UUID]bool{}
	for _, d := range f.Devices {
		site := im.sites[d.SiteRef]
		member := pgtype.Int4{}
		if d.ClusterMemberNo != nil {
			member = pgtype.Int4{Int32: *d.ClusterMemberNo, Valid: true}
		}
		found, err := im.q.NtbDeviceInSite(im.ctx, store.NtbDeviceInSiteParams{OrganizationID: im.m.OrgID, SiteID: site, Hostname: d.Hostname, MemberNo: member})
		// Only devices there before this import count: members of a cluster share a hostname, the second one must not
		// land on the first one just created.
		hasExisting := err == nil && !createdHere[found]
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find device: %w", err)
		}
		action := apigen.NtbImportDeviceActionsReuse
		if a, ok := b.DeviceActions[d.Ref]; ok {
			action = a
		}
		if !hasExisting && action != apigen.NtbImportDeviceActionsSkip {
			action = apigen.NtbImportDeviceActionsCreate
		}
		in := apigen.DeviceInput{Hostname: d.Hostname, Type: apigen.DeviceType(d.Type), SiteId: uuid.UUID(site.Bytes),
			Vendor: &d.Vendor, Model: &d.Model, PartNumber: &d.PartNumber, SerialNumber: &d.SerialNumber, AssetTag: &d.AssetTag,
			Firmware: &d.Firmware, OwnerName: &d.OwnerName, Notes: &d.Notes, Managed: d.Managed}
		if d.Tags != nil {
			in.Tags = &d.Tags
		}
		if d.UHeight > 0 {
			in.UHeight = &d.UHeight
		}
		if d.Role != "" {
			r := apigen.DeviceRole(d.Role)
			in.Role = &r
		}
		if d.Lifecycle != "" {
			l := apigen.DeviceLifecycle(d.Lifecycle)
			in.Lifecycle = &l
		}
		if d.ClusterRef != nil {
			if c, ok := im.clusters[*d.ClusterRef]; ok {
				id := uuid.UUID(c.Bytes)
				in.ClusterId = &id
				if d.ClusterRole != nil {
					r := apigen.ClusterRole(*d.ClusterRole)
					in.ClusterRole = &r
				}
				in.ClusterMemberNo = d.ClusterMemberNo
			}
		}
		switch action {
		case apigen.NtbImportDeviceActionsSkip:
			im.warn("Bỏ qua thiết bị %s (và dây nối tới nó)", d.Hostname)
			continue
		case apigen.NtbImportDeviceActionsReuse:
			im.devices[d.Ref] = found
			im.result.Reused++
			if err := im.mapInterfaces(found, ifacesOf[d.Ref], false); err != nil {
				return "", err
			}
			continue
		}
		fields, msg := validateDevice(bodyFromInput(in))
		if msg != "" {
			return fmt.Sprintf("Thiết bị %s: %s", d.Hostname, msg), nil
		}
		var id *uuid.UUID
		var version int32
		if action == apigen.NtbImportDeviceActionsUpdate {
			cur, ok, err := loadDevice(im.ctx, im.q, im.m, uuid.UUID(found.Bytes))
			if err != nil {
				return "", err
			}
			if !ok {
				return fmt.Sprintf("Thiết bị %s không còn", d.Hostname), nil
			}
			fields = overlayImport(fieldsFromDevice(cur), fields, in)
			u := uuid.UUID(found.Bytes)
			id, version = &u, cur.Version
		}
		var out deviceOutcome
		if err := writeDevice(im.ctx, im.q, im.m, fields, id, version, &out); err != nil {
			if errors.Is(err, errRollback) {
				return fmt.Sprintf("Thiết bị %s: %s", d.Hostname, firstNonEmpty(out.bad, out.conflict, msgCannotEdit)), nil
			}
			return "", err
		}
		im.devices[d.Ref] = out.device.ID
		if action == apigen.NtbImportDeviceActionsCreate {
			im.result.Created.Devices++
			createdHere[out.device.ID] = true
		} else {
			im.result.Reused++
		}
		if err := im.mapInterfaces(out.device.ID, ifacesOf[d.Ref], true); err != nil {
			return "", err
		}
		if action == apigen.NtbImportDeviceActionsCreate {
			if err := im.importIPs(out.device.ID, d, ipsOf[d.Ref]); err != nil {
				return "", err
			}
		}
	}
	return "", nil
}

// mapInterfaces finds the file's ports on the device by name; missing ones are created when `create` (LAGs first, so
// members can name their LAG).
func (im *ntbImporter) mapInterfaces(device pgtype.UUID, ifs []ntbInterface, create bool) error {
	have, err := im.q.ListInterfaces(im.ctx, store.ListInterfacesParams{OrganizationID: im.m.OrgID, DeviceID: device})
	if err != nil {
		return fmt.Errorf("device interfaces: %w", err)
	}
	byName := map[string]pgtype.UUID{}
	sort := int32(0)
	for _, i := range have {
		byName[strings.ToLower(i.Name)] = i.ID
		sort = max(sort, i.SortOrder)
	}
	type pending struct {
		in ntbInterface
		f  ifaceFields
	}
	var batch []pending
	var members []ntbInterface // LAG members: created one by one once their LAG has an id
	for _, i := range ifs {
		if id, ok := byName[strings.ToLower(i.Name)]; ok {
			im.ifaces[i.Ref] = id
			continue
		}
		if !create {
			continue
		}
		if i.LagRef != nil {
			members = append(members, i)
			continue
		}
		f, ok := im.interfaceFields(i, nil)
		if !ok {
			continue
		}
		byName[strings.ToLower(f.name)] = pgtype.UUID{} // a name twice in the file: the first one wins
		batch = append(batch, pending{i, f})
	}

	// The ports of a device in one COPY and one audit entry (like applying a template), instead of a savepoint, a
	// sort query, an insert and an audit row each: a 2,000-device file has some 60,000 ports.
	if len(batch) > 0 {
		ok, err := im.savepoint(func(q store.Querier) error {
			rows := make([]store.CopyInterfacesParams, len(batch))
			names := make([]string, len(batch))
			for k, p := range batch {
				f := p.f
				rows[k] = store.CopyInterfacesParams{
					OrganizationID: im.m.OrgID, DeviceID: device, Name: f.name, Kind: f.kind, Media: f.media, Speed: f.speed,
					Duplex: f.duplex, Mode: f.mode, AccessVlan: f.accessVlan, NativeVlan: f.nativeVlan, AllowedVlans: f.allowed,
					Poe: f.poe, Description: f.description, AdminUp: f.adminUp, SortOrder: sort + int32(k) + 1, Mac: f.mac, VlanTag: f.vlanTag,
				}
				names[k] = f.name
			}
			if _, err := q.CopyInterfaces(im.ctx, rows); err != nil {
				return err
			}
			return deviceAudit(im.ctx, q, im.m, device, "interface.create", nil, map[string]any{"count": len(names), "names": names})
		})
		if err != nil {
			return err
		}
		if ok {
			sort += int32(len(batch))
			created, err := im.q.ListInterfaces(im.ctx, store.ListInterfacesParams{OrganizationID: im.m.OrgID, DeviceID: device})
			if err != nil {
				return fmt.Errorf("device interfaces: %w", err)
			}
			for _, c := range created {
				byName[strings.ToLower(c.Name)] = c.ID
			}
			// Every ref by name, including a name the file repeats.
			for _, i := range ifs {
				if id := byName[strings.ToLower(i.Name)]; id.Valid {
					im.ifaces[i.Ref] = id
				}
			}
		} else {
			// The database refused the batch (a name clash): one by one, skipping the ones it refuses.
			for _, p := range batch {
				delete(byName, strings.ToLower(p.f.name))
			}
			for _, p := range batch {
				if err := im.createInterface(device, p.in, p.f, &sort, byName); err != nil {
					return err
				}
			}
		}
	}
	for _, i := range members {
		var lag *uuid.UUID
		if l, ok := im.ifaces[*i.LagRef]; ok {
			u := uuid.UUID(l.Bytes)
			lag = &u
		}
		f, ok := im.interfaceFields(i, lag)
		if !ok {
			continue
		}
		if err := im.createInterface(device, i, f, &sort, byName); err != nil {
			return err
		}
	}
	return nil
}

// interfaceFields checks a port of the file; fields it leaves out (all optional in the schema) take the API defaults.
func (im *ntbImporter) interfaceFields(i ntbInterface, lag *uuid.UUID) (ifaceFields, bool) {
	var media *apigen.InterfaceMedia
	if i.Media != "" {
		m := apigen.InterfaceMedia(i.Media)
		media = &m
	}
	var mode *apigen.InterfaceMode
	if i.Mode != "" {
		md := apigen.InterfaceMode(i.Mode)
		mode = &md
	}
	var duplex *string
	if i.Duplex != "" {
		duplex = &i.Duplex
	}
	f, msg := validateInterface(i.Name, apigen.InterfaceKind(i.Kind), media, &i.Speed, duplex, mode, i.AccessVlan, i.NativeVlan,
		&i.AllowedVlans, &i.Poe, lag, &i.Description, i.AdminUp, i.MAC, i.VlanTag)
	if msg != "" {
		im.warn("Cổng %s: %s — bỏ qua", i.Name, msg)
		return f, false
	}
	return f, true
}

// createInterface writes one port in its own savepoint (LAG members, or after a refused batch).
func (im *ntbImporter) createInterface(device pgtype.UUID, i ntbInterface, f ifaceFields, sort *int32, byName map[string]pgtype.UUID) error {
	if _, ok := byName[strings.ToLower(f.name)]; ok {
		return nil
	}
	var created store.Interface
	ok, err := im.savepoint(func(q store.Querier) error {
		lagID := pgtype.UUID{}
		if f.lag != nil {
			lagID = pgUUID(*f.lag)
		}
		var err error
		created, err = q.CreateInterface(im.ctx, store.CreateInterfaceParams{
			OrganizationID: im.m.OrgID, DeviceID: device, Name: f.name, Kind: f.kind, Media: f.media, Speed: f.speed,
			Duplex: f.duplex, Mode: f.mode, AccessVlan: f.accessVlan, NativeVlan: f.nativeVlan,
			AllowedVlans: f.allowed, Poe: f.poe, LagID: lagID, Description: f.description, AdminUp: f.adminUp,
			SortOrder: *sort + 1, Mac: f.mac, VlanTag: f.vlanTag,
		})
		if err != nil {
			return err
		}
		return deviceAudit(im.ctx, q, im.m, device, "interface.create", nil, snapInterface(created))
	})
	if err != nil {
		return err
	}
	if !ok {
		im.warn("Cổng %s không tạo được — bỏ qua", i.Name)
		return nil
	}
	*sort++
	im.ifaces[i.Ref] = created.ID
	byName[strings.ToLower(i.Name)] = created.ID
	return nil
}

func (im *ntbImporter) importIPs(device pgtype.UUID, d ntbDevice, ips []ntbIP) error {
	for _, ip := range ips {
		var iface *uuid.UUID
		if ip.InterfaceRef != nil {
			if id, ok := im.ifaces[*ip.InterfaceRef]; ok {
				u := uuid.UUID(id.Bytes)
				iface = &u
			}
		}
		fields, msg := validateIP(ip.Address, apigen.IpRole(ip.Role), &ip.Vrf, &ip.Description, iface)
		if msg != "" {
			im.warn("IP %s của %s: %s — bỏ qua", ip.Address, d.Hostname, msg)
			continue
		}
		ok, err := im.savepoint(func(q store.Querier) error {
			ifaceID := pgtype.UUID{}
			if fields.iface != nil {
				ifaceID = pgUUID(*fields.iface)
			}
			if _, err := q.CreateIP(im.ctx, store.CreateIPParams{OrganizationID: im.m.OrgID, DeviceID: device, InterfaceID: ifaceID,
				Address: fields.addr, Vrf: fields.vrf, Role: fields.role, Description: fields.descr}); err != nil {
				return err
			}
			return deviceAudit(im.ctx, q, im.m, device, "ip.create", nil, ipSnapshot{fields.addr.String(), "", fields.vrf, fields.role, fields.descr})
		})
		if err != nil {
			return err
		}
		if !ok {
			im.warn("IP %s của %s không gán được — bỏ qua", ip.Address, d.Hostname)
		}
	}
	if d.MgmtInterfaceRef != nil {
		if id, ok := im.ifaces[*d.MgmtInterfaceRef]; ok {
			if err := im.q.SetDeviceMgmtInterface(im.ctx, store.SetDeviceMgmtInterfaceParams{InterfaceID: id, ID: device, OrganizationID: im.m.OrgID}); err != nil {
				return fmt.Errorf("set mgmt interface: %w", err)
			}
		}
	}
	return nil
}

func (im *ntbImporter) importGroups(_ apigen.NtbImport, f ntbFile) (string, error) {
	subnetOf := map[string]ntbSubnet{}
	for _, sn := range f.Subnets {
		subnetOf[sn.Ref] = sn
	}
	rangeOf := map[string]ntbRange{}
	for _, r := range f.Ranges {
		rangeOf[r.Ref] = r
	}
	for _, g := range f.EndpointGroups {
		site := im.sites[g.SiteRef]
		found, err := im.q.NtbGroupInSite(im.ctx, store.NtbGroupInSiteParams{OrganizationID: im.m.OrgID, SiteID: site, Name: g.Name})
		if err == nil {
			im.groups[g.Ref] = found
			im.result.Reused++
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find group: %w", err)
		}
		// The range is linked only when the same one is already planned in this organization's IPAM.
		var rng *uuid.UUID
		if g.RangeRef != nil {
			if r, ok := rangeOf[*g.RangeRef]; ok {
				vrf := subnetOf[r.SubnetRef].Vrf
				id, err := im.q.NtbRangeMatch(im.ctx, store.NtbRangeMatchParams{OrganizationID: im.m.OrgID, Vrf: vrf, StartIp: r.StartIP, EndIp: r.EndIP})
				switch {
				case err == nil:
					u := uuid.UUID(id.Bytes)
					rng = &u
				case errors.Is(err, pgx.ErrNoRows):
					im.warn("Nhóm %s: dải IP %s–%s chưa có trong IPAM — tạo dải rồi gắn lại trong panel", g.Name, r.StartIP, r.EndIP)
				default:
					return "", fmt.Errorf("match range: %w", err)
				}
			}
		}
		fields, msg := validateGroup(apigen.EndpointKind(g.Kind), g.Name, uuid.UUID(site.Bytes), rng, g.ExpectedCount, &g.Notes)
		if msg != "" {
			return fmt.Sprintf("Nhóm %s: %s", g.Name, msg), nil
		}
		var out writeOutcome
		var row store.GetEndpointGroupRow
		ok, err := im.savepoint(func(q store.Querier) error {
			var err error
			row, err = writeGroup(im.ctx, q, im.m, fields, nil, 0, &out)
			return err
		})
		if err != nil {
			return "", err
		}
		if !ok && rng != nil {
			// The range may not fit this site: try again without it.
			fields.rng = nil
			ok, err = im.savepoint(func(q store.Querier) error {
				var err error
				row, err = writeGroup(im.ctx, q, im.m, fields, nil, 0, &out)
				return err
			})
			if err != nil {
				return "", err
			}
			if ok {
				im.warn("Nhóm %s: không gắn được dải IP (%s)", g.Name, firstNonEmpty(out.bad, out.conf))
			}
		}
		if !ok {
			return fmt.Sprintf("Nhóm %s: %s", g.Name, firstNonEmpty(out.bad, out.conf, msgCannotEdit)), nil
		}
		im.groups[g.Ref] = row.ID
		im.result.Created.EndpointGroups++
	}
	return "", nil
}

func (im *ntbImporter) end(e ntbEnd) (apigen.LinkEndInput, bool) {
	var id pgtype.UUID
	var ok bool
	if e.Kind == "endpoint_group" {
		id, ok = im.groups[e.Ref]
	} else {
		id, ok = im.devices[e.Ref]
	}
	if !ok {
		return apigen.LinkEndInput{}, false
	}
	out := apigen.LinkEndInput{Kind: apigen.LinkEndKind(e.Kind), Id: uuid.UUID(id.Bytes)}
	if e.InterfaceRef != nil {
		if iface, ok := im.ifaces[*e.InterfaceRef]; ok {
			u := uuid.UUID(iface.Bytes)
			out.InterfaceId = &u
		}
	}
	return out, true
}

func (im *ntbImporter) importLinks(_ apigen.NtbImport, f ntbFile) (string, error) {
	for _, l := range f.Links {
		a, okA := im.end(l.A)
		b, okB := im.end(l.B)
		if !okA || !okB {
			continue // an end was skipped
		}
		ifaceOf := func(e apigen.LinkEndInput) pgtype.UUID {
			if e.InterfaceId == nil {
				return pgtype.UUID{}
			}
			return pgUUID(*e.InterfaceId)
		}
		same, err := im.q.NtbLinkBetween(im.ctx, store.NtbLinkBetweenParams{OrganizationID: im.m.OrgID, AID: pgUUID(a.Id), BID: pgUUID(b.Id),
			AIface: ifaceOf(a), BIface: ifaceOf(b)})
		if err == nil {
			im.links[l.Ref] = same
			im.result.Reused++
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find link: %w", err)
		}
		in := apigen.LinkInput{A: a, B: b, Kind: apigen.LinkKind(l.Kind), Medium: &l.Medium, Speed: &l.Speed, LengthM: l.LengthM,
			CableId: &l.CableID, Provider: &l.Provider, CircuitId: &l.CircuitID, Bandwidth: &l.Bandwidth, Notes: &l.Notes}
		if l.Status != "" {
			st := apigen.LinkStatus(l.Status)
			in.Status = &st
		}
		if l.FiberMode != "" {
			fm := apigen.LinkFiberMode(l.FiberMode)
			in.FiberMode = &fm
		}
		if l.Connector != "" {
			c := apigen.LinkConnector(l.Connector)
			in.Connector = &c
		}
		if l.Service != "" {
			sv := apigen.LinkService(l.Service)
			in.Service = &sv
		}
		var out writeOutcome
		var saved apigen.Link
		ok, err := im.savepoint(func(q store.Querier) error {
			var err error
			saved, err = writeLink(im.ctx, q, im.m, in, nil, 0, &out)
			return err
		})
		if err != nil {
			return "", err
		}
		if !ok {
			im.warn("Dây %s: %s — bỏ qua", l.Kind, firstNonEmpty(out.bad, out.conf, "không tạo được"))
			continue
		}
		im.links[l.Ref] = pgUUID(saved.Id)
		im.result.Created.Links++
	}
	return "", nil
}

// importDiagram creates the diagram with the file's view, its refs turned into the new ids.
func (im *ntbImporter) importDiagram(name string, f ntbFile) (pgtype.UUID, error) {
	id, err := im.q.CreateDiagram(im.ctx, store.CreateDiagramParams{OrganizationID: im.m.OrgID, Name: name, Layer: f.Diagram.Layer,
		Description: f.Diagram.Description, CreatedBy: pgUUID(uuid.UUID(im.m.UserID.Bytes))})
	if err != nil {
		return id, fmt.Errorf("create diagram: %w", err)
	}
	view := apigen.DiagramView{Nodes: []apigen.DiagramNode{}, Edges: []apigen.DiagramEdge{}, Annotations: []apigen.DiagramAnnotation{}}
	for _, n := range f.Diagram.View.Nodes {
		var ref pgtype.UUID
		var ok bool
		if n.RefKind == "endpoint_group" {
			ref, ok = im.groups[n.RefID]
		} else {
			ref, ok = im.devices[n.RefID]
		}
		if !ok {
			continue
		}
		dn := apigen.DiagramNode{Id: n.ID, RefKind: apigen.DiagramNodeRefKind(n.RefKind), RefId: uuid.UUID(ref.Bytes), X: n.X, Y: n.Y,
			Width: n.Width, Height: n.Height, Locked: n.Locked}
		if n.LabelStyle != nil && validColor(n.LabelStyle["color"]) {
			ls := n.LabelStyle
			dn.LabelStyle = &ls
		}
		view.Nodes = append(view.Nodes, dn)
	}
	for _, e := range f.Diagram.View.Edges {
		link, ok := im.links[e.LinkRef]
		if !ok {
			continue
		}
		de := apigen.DiagramEdge{Id: e.ID, LinkId: uuid.UUID(link.Bytes)}
		if e.Routing != "" {
			r := apigen.DiagramEdgeRouting(e.Routing)
			de.Routing = &r
		}
		if len(e.Waypoints) > 0 {
			pts := make([]apigen.DiagramPoint, 0, len(e.Waypoints))
			for _, p := range e.Waypoints {
				pts = append(pts, apigen.DiagramPoint{X: p.X, Y: p.Y})
			}
			de.Waypoints = &pts
		}
		view.Edges = append(view.Edges, de)
	}
	for _, a := range f.Diagram.View.Annotations {
		da := apigen.DiagramAnnotation{Id: a.ID, Kind: apigen.DiagramAnnotationKind(a.Kind), X: a.X, Y: a.Y, Width: a.Width, Height: a.Height,
			FontSize: a.FontSize}
		if a.Text != "" {
			t := a.Text
			da.Text = &t
		}
		if a.Color != "" && validColor(a.Color) {
			c := a.Color
			da.Color = &c
		}
		if a.LineStyle != "" {
			ls := apigen.DiagramAnnotationLineStyle(a.LineStyle)
			da.LineStyle = &ls
		}
		if len(a.Points) > 0 {
			pts := make([]apigen.DiagramPoint, 0, len(a.Points))
			for _, p := range a.Points {
				pts = append(pts, apigen.DiagramPoint{X: p.X, Y: p.Y})
			}
			da.Points = &pts
		}
		if a.SiteRef != nil && a.Kind == "zone" {
			if site, ok := im.sites[*a.SiteRef]; ok {
				u := uuid.UUID(site.Bytes)
				da.SiteId = &u
			}
		}
		view.Annotations = append(view.Annotations, da)
	}
	if v := f.Diagram.View.Viewport; v != nil {
		view.Viewport = &apigen.DiagramViewport{X: v.X, Y: v.Y, Zoom: v.Zoom}
	}
	if f.Diagram.View.LabelTemplate != "" {
		lt := f.Diagram.View.LabelTemplate
		view.LabelTemplate = &lt
	}
	if f.Diagram.View.PortStyle != "" {
		ps := apigen.DiagramViewPortStyle(f.Diagram.View.PortStyle)
		view.PortStyle = &ps
	}
	if msg := checkViewShape(view); msg != "" {
		return id, fmt.Errorf("imported view: %s", msg)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		return id, fmt.Errorf("encode view: %w", err)
	}
	d, _, ok, err := loadDiagram(im.ctx, im.q, im.m, uuid.UUID(id.Bytes))
	if err != nil || !ok {
		return id, fmt.Errorf("load imported diagram: %w", err)
	}
	if _, err := im.q.SaveDiagramView(im.ctx, store.SaveDiagramViewParams{ID: id, OrganizationID: im.m.OrgID, Version: d.Version, View: raw}); err != nil {
		return id, fmt.Errorf("save imported view: %w", err)
	}
	return id, audit.Write(im.ctx, im.q, audit.Entry{OrganizationID: im.m.OrgID, Actor: im.m.UserID, Action: "diagram.create",
		ObjectType: "diagram", ObjectID: uuidStr(id), After: snapDiagram(d), Meta: infoFrom(im.ctx).meta})
}
