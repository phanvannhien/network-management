package api

import (
	"context"
	"fmt"
	"net/netip"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// searchLimit caps each group of hits: the palette shows a handful, the lists have the full filters.
const searchLimit = 10

var (
	ipPrefixRe  = regexp.MustCompile(`^[0-9.]+$|^[0-9a-fA-F:]*:[0-9a-fA-F:.]*$`)
	ipv4CharsRe = regexp.MustCompile(`^[0-9.]*\.[0-9.]*$`)
	ciscoMACRe  = regexp.MustCompile(`^[0-9a-fA-F]{4}(\.[0-9a-fA-F]{0,4}){1,2}$`)
	macCharsRe  = regexp.MustCompile(`^[0-9a-fA-F:.\-]+$`)
)

// likeEscape makes user text literal inside a LIKE pattern.
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// macHex turns any MAC notation being typed (aa:bb:cc…, aabb.ccdd…, aa-bb-cc…) into lower-case bare hex; "" when the
// text cannot be (part of) a MAC or is too short to be worth a lookup.
func macHex(q string) string {
	if !macCharsRe.MatchString(q) {
		return ""
	}
	hex := strings.ToLower(strings.NewReplacer(":", "", ".", "", "-", "").Replace(q))
	if len(hex) < 4 || len(hex) > 12 {
		return ""
	}
	return hex
}

// searchIPs finds addresses for the text: an exact address (any notation, IPv6 included), every address of a subnet
// ("10.136.10.0/24"), or those starting with what is being typed ("10.136."); none when it is not address-like.
func (s *Server) searchIPs(ctx context.Context, org pgtype.UUID, q string) ([]store.SearchIPsRow, error) {
	in := func(p netip.Prefix) ([]store.SearchIPsRow, error) {
		r, err := s.q.SearchIPsIn(ctx, store.SearchIPsInParams{OrganizationID: org, Cidr: p, Lim: searchLimit})
		if err != nil {
			return nil, fmt.Errorf("search ips in prefix: %w", err)
		}
		out := make([]store.SearchIPsRow, len(r))
		for i, x := range r {
			out[i] = store.SearchIPsRow(x)
		}
		return out, nil
	}
	if p, err := netip.ParsePrefix(q); err == nil {
		if p.Masked() == p && p.Bits() < p.Addr().BitLen() {
			return in(p)
		}
		// A host with its mask ("10.0.0.1/24"): that address.
		return in(netip.PrefixFrom(p.Addr(), p.Addr().BitLen()))
	}
	if a, err := netip.ParseAddr(q); err == nil {
		return in(netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	if !ipPrefixRe.MatchString(q) || !strings.ContainsAny(q, ".:") {
		return nil, nil
	}
	r, err := s.q.SearchIPs(ctx, store.SearchIPsParams{OrganizationID: org, Q: likeEscape(strings.ToLower(q)), Lim: searchLimit})
	if err != nil {
		return nil, fmt.Errorf("search ips: %w", err)
	}
	return r, nil
}

// GlobalSearch looks the text up across the inventory (P1-23, SRS §2): devices by hostname / S/N / part number /
// model / asset tag, clusters, addresses (exact, a subnet's, or the prefix being typed), MACs in any notation,
// endpoint groups. Each hit
// lists the diagrams placing it so the palette can open it there.
func (s *Server) GlobalSearch(ctx context.Context, req apigen.GlobalSearchRequestObject) (apigen.GlobalSearchResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	q := strings.TrimSpace(req.Params.Q)
	if len([]rune(q)) < 2 || len([]rune(q)) > 100 {
		return apigen.GlobalSearch400JSONResponse{BadRequestJSONResponse: apigen.BadRequestJSONResponse{Message: "Từ khóa cần 2–100 ký tự"}}, nil
	}
	like := likeEscape(q)
	out := apigen.SearchResult{
		Devices: []apigen.SearchDeviceHit{}, Clusters: []apigen.SearchClusterHit{}, Ips: []apigen.SearchIPHit{}, Macs: []apigen.SearchMACHit{}, Groups: []apigen.SearchGroupHit{},
	}

	devices, err := s.q.SearchDevices(ctx, store.SearchDevicesParams{OrganizationID: m.OrgID, Q: like, Lim: searchLimit})
	if err != nil {
		return nil, fmt.Errorf("search devices: %w", err)
	}
	ips, err := s.searchIPs(ctx, m.OrgID, q)
	if err != nil {
		return nil, err
	}
	var macs []store.SearchMACsRow
	// Digits and dots are an address being typed, not a MAC (unless in Cisco's aabb.ccdd.eeff groups).
	if hex := macHex(q); hex != "" && (!ipv4CharsRe.MatchString(q) || ciscoMACRe.MatchString(q)) {
		if macs, err = s.q.SearchMACs(ctx, store.SearchMACsParams{OrganizationID: m.OrgID, Hex: hex, Lim: searchLimit}); err != nil {
			return nil, fmt.Errorf("search macs: %w", err)
		}
	}
	clusters, err := s.q.SearchClusters(ctx, store.SearchClustersParams{OrganizationID: m.OrgID, Q: like, Lim: searchLimit})
	if err != nil {
		return nil, fmt.Errorf("search clusters: %w", err)
	}
	groups, err := s.q.SearchGroups(ctx, store.SearchGroupsParams{OrganizationID: m.OrgID, Q: like, Lim: searchLimit})
	if err != nil {
		return nil, fmt.Errorf("search groups: %w", err)
	}

	// One lookup of the diagrams placing any hit: devices, clusters and groups are placed by their id.
	ids := map[string]bool{}
	for _, d := range devices {
		ids[uuidStr(d.ID)] = true
	}
	for _, a := range ips {
		for _, id := range []*uuid.UUID{optUUID(a.DeviceID), optUUID(a.ClusterID), optUUID(a.GroupID)} {
			if id != nil {
				ids[id.String()] = true
			}
		}
	}
	for _, x := range macs {
		for _, id := range []*uuid.UUID{optUUID(x.DeviceID), optUUID(x.GroupID)} {
			if id != nil {
				ids[id.String()] = true
			}
		}
	}
	for _, g := range groups {
		ids[uuidStr(g.ID)] = true
	}
	// A cluster is drawn through its members: it is on the diagrams showing any of them.
	members := map[string][]string{}
	var clusterIDs []pgtype.UUID
	for _, c := range clusters {
		clusterIDs = append(clusterIDs, c.ID)
	}
	for _, a := range ips {
		if a.ClusterID.Valid {
			clusterIDs = append(clusterIDs, a.ClusterID)
		}
	}
	if len(clusterIDs) > 0 {
		rows, err := s.q.SearchClusterMembers(ctx, store.SearchClusterMembersParams{OrganizationID: m.OrgID, ClusterIds: clusterIDs})
		if err != nil {
			return nil, fmt.Errorf("cluster members: %w", err)
		}
		for _, r := range rows {
			members[uuidStr(r.ClusterID)] = append(members[uuidStr(r.ClusterID)], uuidStr(r.ID))
			ids[uuidStr(r.ID)] = true
		}
	}
	shown := map[string][]apigen.SearchDiagram{}
	if len(ids) > 0 {
		list := make([]string, 0, len(ids))
		for id := range ids {
			list = append(list, id)
		}
		rows, err := s.q.ListDiagramsShowing(ctx, store.ListDiagramsShowingParams{OrganizationID: m.OrgID, Ids: list})
		if err != nil {
			return nil, fmt.Errorf("diagrams showing hits: %w", err)
		}
		for _, r := range rows {
			for _, ref := range r.RefIds {
				shown[ref] = append(shown[ref], apigen.SearchDiagram{Id: uuid.UUID(r.ID.Bytes), Name: r.Name})
			}
		}
	}
	diagramsOf := func(ids ...*uuid.UUID) []apigen.SearchDiagram {
		for _, id := range ids {
			if id != nil {
				if d := shown[id.String()]; d != nil {
					return d
				}
				// Members' diagrams, each once.
				var out []apigen.SearchDiagram
				seen := map[uuid.UUID]bool{}
				for _, mem := range members[id.String()] {
					for _, d := range shown[mem] {
						if !seen[d.Id] {
							seen[d.Id] = true
							out = append(out, d)
						}
					}
				}
				if out != nil {
					return out
				}
			}
		}
		return []apigen.SearchDiagram{}
	}

	for _, d := range devices {
		value := map[string]string{"hostname": d.Hostname, "serial": d.SerialNumber, "partNumber": d.PartNumber, "model": d.Model, "assetTag": d.AssetTag}[d.Matched]
		id := uuid.UUID(d.ID.Bytes)
		out.Devices = append(out.Devices, apigen.SearchDeviceHit{
			Id: id, Hostname: d.Hostname, Type: apigen.DeviceType(d.Type), SiteCode: d.SiteCode,
			Matched: apigen.SearchDeviceHitMatched(d.Matched), MatchedValue: value, Diagrams: diagramsOf(&id),
		})
	}
	for _, a := range ips {
		out.Ips = append(out.Ips, apigen.SearchIPHit{
			Host: a.Host, Address: a.Address, Role: a.Role, DeviceId: optUUID(a.DeviceID), ClusterId: optUUID(a.ClusterID),
			GroupId: optUUID(a.GroupID), Name: a.Hostname, InterfaceName: a.InterfaceName, SiteCode: a.SiteCode,
			Diagrams: diagramsOf(optUUID(a.DeviceID), optUUID(a.ClusterID), optUUID(a.GroupID)),
		})
	}
	for _, x := range macs {
		out.Macs = append(out.Macs, apigen.SearchMACHit{
			Mac: x.Mac, DeviceId: optUUID(x.DeviceID), GroupId: optUUID(x.GroupID), Name: x.Hostname,
			InterfaceName: x.InterfaceName, Diagrams: diagramsOf(optUUID(x.DeviceID), optUUID(x.GroupID)),
		})
	}
	for _, g := range groups {
		id := uuid.UUID(g.ID.Bytes)
		out.Groups = append(out.Groups, apigen.SearchGroupHit{
			Id: id, Name: g.Name, Kind: apigen.EndpointKind(g.Kind), SiteCode: g.SiteCode, Diagrams: diagramsOf(&id),
		})
	}
	for _, c := range clusters {
		id := uuid.UUID(c.ID.Bytes)
		out.Clusters = append(out.Clusters, apigen.SearchClusterHit{
			Id: id, Name: c.Name, Kind: apigen.ClusterKind(c.Kind), Hostname: c.Hostname, SiteCode: c.SiteCode, Diagrams: diagramsOf(&id),
		})
	}
	return apigen.GlobalSearch200JSONResponse(out), nil
}
