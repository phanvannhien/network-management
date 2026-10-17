package api

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Site graph (P2-21, ADR-040): an overview diagram stores only where its site nodes sit; what a site node shows (WAN
// lines, gateway, counts, detail diagrams) and the edges between sites come from the inventory each time, so an
// overview never goes stale.

// serviceCode says what a link carries (the client translates it).
func serviceCode(kind, service string) apigen.SiteLinkService {
	switch service {
	case "internet_broadband", "internet_dedicated", "mpls", "leased_line", "metro", "mobile":
		return apigen.SiteLinkService(service)
	}
	switch kind {
	case "logical":
		return apigen.SiteLinkServiceVpn
	case "wireless":
		return apigen.SiteLinkServiceWireless
	case "cellular":
		return apigen.SiteLinkServiceMobile
	case "dsl":
		return apigen.SiteLinkServiceDsl
	case "fiber":
		return apigen.SiteLinkServiceFiber
	case "ethernet":
		return apigen.SiteLinkServiceEthernet
	}
	return apigen.SiteLinkServiceOther
}

// edgeStyle: solid for dedicated circuits / cables, dashed for VPN over Internet, dotted for radio / mobile backups.
func edgeStyle(kind, service string) apigen.SiteEdgeStyle {
	switch {
	case kind == "logical":
		return apigen.SiteEdgeStyleVpn
	case kind == "wireless" || kind == "cellular" || service == "mobile":
		return apigen.SiteEdgeStyleWireless
	case service == "mpls" || service == "leased_line" || service == "metro" || kind == "fiber" || kind == "ethernet":
		return apigen.SiteEdgeStyleDedicated
	}
	return apigen.SiteEdgeStyleOther
}

func (s *Server) GetSiteGraph(ctx context.Context, req apigen.GetSiteGraphRequestObject) (apigen.GetSiteGraphResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	var cat pgtype.UUID
	if req.Params.CategoryId != nil {
		cat = pgUUID(*req.Params.CategoryId)
		if _, err := s.q.GetCategory(ctx, store.GetCategoryParams{ID: cat, OrganizationID: m.OrgID}); errors.Is(err, pgx.ErrNoRows) {
			return apigen.GetSiteGraph404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy danh mục")}, nil
		} else if err != nil {
			return nil, fmt.Errorf("site graph category: %w", err)
		}
	}
	sites, err := s.q.SiteGraphSites(ctx, store.SiteGraphSitesParams{OrganizationID: m.OrgID, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("site graph sites: %w", err)
	}
	out := apigen.SiteGraph{Sites: []apigen.SiteCard{}, Edges: []apigen.SiteEdge{}}
	idx := map[pgtype.UUID]int{}
	for _, r := range sites {
		idx[r.ID] = len(out.Sites)
		out.Sites = append(out.Sites, apigen.SiteCard{
			Id: uuid.UUID(r.ID.Bytes), Code: r.Code, LocalCode: r.LocalCode, Name: r.Name, Kind: apigen.SiteKind(r.Kind),
			CategoryId: optUUID(r.CategoryID), CategoryPath: r.CategoryPath, Devices: int(r.Devices), Planned: int(r.Planned),
			Groups: int(r.Groups), Wan: []apigen.SiteWan{}, Diagrams: []apigen.SearchDiagram{},
		})
	}

	// Gateway: the site's firewalls (else routers / VPN gateways) — "FortiGate 60F ×2 HA".
	gws, err := s.q.SiteGraphGateways(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("site graph gateways: %w", err)
	}
	type gwInfo struct {
		model string
		count int
		ha    bool
		rank  int
	}
	rankOf := map[string]int{"firewall": 0, "sdwan_edge": 1, "vpn_gateway": 2, "router": 3}
	best := map[pgtype.UUID]*gwInfo{}
	for _, g := range gws {
		if _, ok := idx[g.SiteID]; !ok {
			continue
		}
		b := best[g.SiteID]
		r := rankOf[g.Type]
		switch {
		case b == nil || r < b.rank:
			best[g.SiteID] = &gwInfo{model: g.Model, count: 1, ha: g.ClusterKind != "" && g.ClusterKind != "stack", rank: r}
		case r == b.rank && g.Model == b.model:
			b.count++
			b.ha = b.ha || (g.ClusterKind != "" && g.ClusterKind != "stack")
		}
	}
	for id, b := range best {
		label := firstNonEmpty(b.model, "?")
		if b.count > 1 {
			label += fmt.Sprintf(" ×%d", b.count)
		}
		if b.ha {
			label += " HA"
		}
		out.Sites[idx[id]].Gateway = label
	}

	// WAN lines to ISPs.
	wans, err := s.q.SiteGraphWan(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("site graph wan: %w", err)
	}
	for _, w := range wans {
		i, ok := idx[w.SiteID]
		if !ok {
			continue
		}
		svc := serviceCode("ethernet", w.Service)
		if w.Service == "" {
			svc = apigen.SiteLinkServiceInternetBroadband
		}
		line := apigen.SiteWan{Provider: firstNonEmpty(strings.TrimSpace(w.Provider), strings.TrimSpace(w.Cloud)), Service: svc,
			Bandwidth: strings.TrimSpace(w.Bandwidth), Count: 1}
		// The same line seen from both members of an HA pair: one chip "×2".
		merged := false
		for k := range out.Sites[i].Wan {
			x := &out.Sites[i].Wan[k]
			if x.Provider == line.Provider && x.Service == line.Service && x.Bandwidth == line.Bandwidth {
				x.Count++
				merged = true
			}
		}
		if !merged {
			out.Sites[i].Wan = append(out.Sites[i].Wan, line)
		}
	}

	// Edges: links across two sites of the graph, one edge per unordered pair, each link counted once.
	links, err := s.q.SiteGraphLinks(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("site graph links: %w", err)
	}
	type pair struct{ a, b pgtype.UUID }
	type key struct {
		service   apigen.SiteLinkService
		medium    string
		bandwidth string
	}
	type agg struct {
		labels map[key]int
		styles map[apigen.SiteEdgeStyle]int
		n      int
	}
	edges := map[pair]*agg{}
	peers := map[pgtype.UUID]map[pgtype.UUID]bool{}
	for _, l := range links {
		_, okA := idx[l.SiteA]
		_, okB := idx[l.SiteB]
		if !okA || !okB {
			continue
		}
		p := pair{l.SiteA, l.SiteB}
		if uuidStr(p.b) < uuidStr(p.a) {
			p = pair{p.b, p.a}
		}
		e := edges[p]
		if e == nil {
			e = &agg{labels: map[key]int{}, styles: map[apigen.SiteEdgeStyle]int{}}
			edges[p] = e
		}
		e.n++
		e.labels[key{serviceCode(l.Kind, l.Service), strings.TrimSpace(l.Medium), strings.TrimSpace(l.Bandwidth)}]++
		e.styles[edgeStyle(l.Kind, l.Service)]++
		for _, x := range []pgtype.UUID{p.a, p.b} {
			if peers[x] == nil {
				peers[x] = map[pgtype.UUID]bool{}
			}
		}
		peers[p.a][p.b], peers[p.b][p.a] = true, true
	}
	for p, e := range edges {
		// The dominant service (most links; ties by name) labels the edge, "+N" counts the others.
		var top key
		best := -1
		for k, n := range e.labels {
			if n > best || (n == best && fmt.Sprint(k) < fmt.Sprint(top)) {
				top, best = k, n
			}
		}
		style, most := apigen.SiteEdgeStyleOther, 0
		for _, st := range []apigen.SiteEdgeStyle{apigen.SiteEdgeStyleDedicated, apigen.SiteEdgeStyleVpn, apigen.SiteEdgeStyleWireless, apigen.SiteEdgeStyleOther} {
			if e.styles[st] > most {
				style, most = st, e.styles[st]
			}
		}
		out.Edges = append(out.Edges, apigen.SiteEdge{A: uuid.UUID(p.a.Bytes), B: uuid.UUID(p.b.Bytes), Links: e.n, Service: top.service,
			Medium: top.medium, Bandwidth: top.bandwidth, More: e.n - best, Style: style})
	}
	sort.Slice(out.Edges, func(i, j int) bool {
		if out.Edges[i].A != out.Edges[j].A {
			return out.Edges[i].A.String() < out.Edges[j].A.String()
		}
		return out.Edges[i].B.String() < out.Edges[j].B.String()
	})
	for id, ps := range peers {
		out.Sites[idx[id]].Peers = len(ps)
	}

	// Detail diagrams of each site.
	dgs, err := s.q.SiteGraphDiagrams(ctx, m.OrgID)
	if err != nil {
		return nil, fmt.Errorf("site graph diagrams: %w", err)
	}
	for _, d := range dgs {
		if i, ok := idx[d.SiteID]; ok {
			out.Sites[i].Diagrams = append(out.Sites[i].Diagrams, apigen.SearchDiagram{Id: uuid.UUID(d.ID.Bytes), Name: d.Name})
		}
	}
	return apigen.GetSiteGraph200JSONResponse(out), nil
}
