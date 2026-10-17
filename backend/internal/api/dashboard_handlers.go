package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

const (
	// expiringDays: warranty / end-of-support dates shown this far ahead (DESIGN.md §7c "Sắp hết hạn (90 ngày)").
	expiringDays = 90
	// missingShown: devices listed under "missing information"; the total is counted in full.
	missingShown = 20
	// fullPercent: a subnet this used is about to run out of addresses (SRS §7 "dải đầy").
	fullPercent = 90
)

// GetDashboard gathers the organization's figures (P1-24, SRS §2, DESIGN.md §7c): devices by site / type / lifecycle,
// the problems only the whole inventory can show (duplicate IP / hostname / serial, a port with two cables, subnets
// running out — DHCP / reserved pools count as taken —, devices without a cable or a management interface), active
// devices missing information and warranty / end-of-support dates coming up or past. The checks of one drawing stay in the editor (P1-20).
func (s *Server) GetDashboard(ctx context.Context, req apigen.GetDashboardRequestObject) (apigen.GetDashboardResponseObject, error) {
	m, err := tenant.Require(ctx, req.OrgId)
	if err != nil {
		return nil, err
	}
	org := m.OrgID
	var cat pgtype.UUID
	if req.Params.CategoryId != nil {
		cat = pgUUID(*req.Params.CategoryId)
		if _, err := s.q.GetCategory(ctx, store.GetCategoryParams{ID: cat, OrganizationID: org}); errors.Is(err, pgx.ErrNoRows) {
			return apigen.GetDashboard404JSONResponse{NotFoundJSONResponse: notFoundBody("Không tìm thấy danh mục")}, nil
		} else if err != nil {
			return nil, fmt.Errorf("dashboard category: %w", err)
		}
	}
	out := apigen.Dashboard{
		GeneratedAt: time.Now().UTC(),
		BySite:      []apigen.DashboardSite{}, ByType: []apigen.DashboardTypeCount{}, Problems: []apigen.DashboardProblem{},
		MissingInfo: []apigen.DashboardMissing{}, Expiring: []apigen.DashboardExpiry{},
	}

	sites, err := s.q.DashboardBySite(ctx, store.DashboardBySiteParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard by site: %w", err)
	}
	t := &out.Totals
	for _, r := range sites {
		out.BySite = append(out.BySite, apigen.DashboardSite{
			SiteId: uuid.UUID(r.ID.Bytes), Code: r.Code, Name: r.Name, Total: int(r.Total), Active: int(r.Active),
			Planned: int(r.Planned), Spare: int(r.Spare), Rma: int(r.Rma), Retired: int(r.Retired),
		})
		t.Devices += int(r.Total)
		t.Active += int(r.Active)
		t.Planned += int(r.Planned)
		t.Spare += int(r.Spare)
		t.Rma += int(r.Rma)
		t.Retired += int(r.Retired)
	}
	types, err := s.q.DashboardByType(ctx, store.DashboardByTypeParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard by type: %w", err)
	}
	for _, r := range types {
		out.ByType = append(out.ByType, apigen.DashboardTypeCount{Type: apigen.DeviceType(r.Type), Count: int(r.Total)})
	}

	missing, err := s.q.DashboardMissingInfo(ctx, store.DashboardMissingInfoParams{OrganizationID: org, CategoryFilter: cat, Lim: missingShown})
	if err != nil {
		return nil, fmt.Errorf("dashboard missing info: %w", err)
	}
	for _, r := range missing {
		t.MissingInfo = int(r.Total)
		var what []apigen.DashboardMissingMissing
		for _, x := range []struct {
			on   bool
			name apigen.DashboardMissingMissing
		}{
			{r.NoSerial, apigen.DashboardMissingMissingSerial}, {r.NoPart, apigen.DashboardMissingMissingPartNumber},
			{r.NoModel, apigen.DashboardMissingMissingModel}, {r.NoLocation, apigen.DashboardMissingMissingLocation},
		} {
			if x.on {
				what = append(what, x.name)
			}
		}
		out.MissingInfo = append(out.MissingInfo, apigen.DashboardMissing{Id: uuid.UUID(r.ID.Bytes), Hostname: r.Hostname, SiteCode: r.SiteCode, Missing: what})
	}

	// Dates are calendar days where the server runs (set TZ for the organization's country).
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	expiring, err := s.q.DashboardExpiring(ctx, store.DashboardExpiringParams{
		OrganizationID: org, CategoryFilter: cat,
		Today: pgtype.Date{Time: today, Valid: true}, Until: pgtype.Date{Time: today.AddDate(0, 0, expiringDays), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("dashboard expiring: %w", err)
	}
	for _, r := range expiring {
		t.Expired = int(r.Overdue)
		t.Expiring = int(r.Total - r.Overdue)
		out.Expiring = append(out.Expiring, apigen.DashboardExpiry{
			DeviceId: uuid.UUID(r.ID.Bytes), Hostname: r.Hostname, SiteCode: r.SiteCode, Kind: apigen.DashboardExpiryKind(r.Kind),
			Date: openapi_types.Date{Time: r.Day.Time}, Days: int(r.Day.Time.Sub(today).Hours() / 24),
		})
	}

	problems, err := s.dashboardProblems(ctx, org, cat)
	if err != nil {
		return nil, err
	}
	for _, p := range problems {
		switch p.Severity {
		case apigen.DashboardProblemSeverityError:
			t.Errors++
		case apigen.DashboardProblemSeverityWarning:
			t.Warnings++
		}
		if p.Kind == apigen.SubnetFull {
			t.SubnetsFull++
		}
	}
	out.Problems = problems
	return apigen.GetDashboard200JSONResponse(out), nil
}

// dashboardProblems lists the org-wide problems, errors first: one row per conflict, a count for the info ones.
func (s *Server) dashboardProblems(ctx context.Context, org, cat pgtype.UUID) ([]apigen.DashboardProblem, error) {
	var errs, warns, infos []apigen.DashboardProblem
	add := func(p apigen.DashboardProblem) {
		switch p.Severity {
		case apigen.DashboardProblemSeverityError:
			errs = append(errs, p)
		case apigen.DashboardProblemSeverityWarning:
			warns = append(warns, p)
		default:
			infos = append(infos, p)
		}
	}

	ips, err := s.q.DashboardDuplicateIps(ctx, store.DashboardDuplicateIpsParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard duplicate ips: %w", err)
	}
	for _, r := range ips {
		subject := r.Address
		if r.Vrf != "" {
			subject += " (VRF " + r.Vrf + ")"
		}
		add(apigen.DashboardProblem{Kind: apigen.DuplicateIp, Severity: apigen.DashboardProblemSeverity(r.Severity), Subject: subject,
			Detail: strings.Join(r.Holders, ", "), Count: int(r.Owners)})
	}
	hosts, err := s.q.DashboardDuplicateHostnames(ctx, store.DashboardDuplicateHostnamesParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard duplicate hostnames: %w", err)
	}
	for _, r := range hosts {
		add(apigen.DashboardProblem{Kind: apigen.DuplicateHostname, Severity: apigen.DashboardProblemSeverityError, Subject: r.Hostname, Count: int(r.Total)})
	}
	serials, err := s.q.DashboardDuplicateSerials(ctx, store.DashboardDuplicateSerialsParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard duplicate serials: %w", err)
	}
	for _, r := range serials {
		add(apigen.DashboardProblem{Kind: apigen.DuplicateSerial, Severity: apigen.DashboardProblemSeverityError, Subject: r.Serial,
			Detail: strings.Join(r.Hostnames, ", "), Count: len(r.Hostnames)})
	}
	ports, err := s.q.DashboardPortsMultiLink(ctx, store.DashboardPortsMultiLinkParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard ports with several cables: %w", err)
	}
	for _, r := range ports {
		id := uuid.UUID(r.DeviceID.Bytes)
		add(apigen.DashboardProblem{Kind: apigen.PortMultiLink, Severity: apigen.DashboardProblemSeverityError,
			Subject: r.Hostname + " " + r.InterfaceName, Count: int(r.Links), DeviceId: &id})
	}
	subnets, err := s.q.DashboardSubnets(ctx, store.DashboardSubnetsParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard subnets: %w", err)
	}
	for _, r := range subnets {
		// /30–/32 are point-to-point links and single hosts: full by design (the query leaves them out too).
		if r.Bits > 29 {
			continue
		}
		size := int64(1)<<(32-r.Bits) - 2
		if r.Used*100 >= size*fullPercent {
			id := uuid.UUID(r.ID.Bytes)
			subject := r.Cidr
			if r.Vrf != "" {
				subject += " (VRF " + r.Vrf + ")"
			}
			add(apigen.DashboardProblem{Kind: apigen.SubnetFull, Severity: apigen.DashboardProblemSeverityWarning, Subject: subject,
				Detail: fmt.Sprintf("%d/%d", r.Used, size), Count: int(r.Used * 100 / size), SubnetId: &id})
		}
	}
	counts, err := s.q.DashboardCounts(ctx, store.DashboardCountsParams{OrganizationID: org, CategoryFilter: cat})
	if err != nil {
		return nil, fmt.Errorf("dashboard counts: %w", err)
	}
	if counts.NoLink > 0 {
		add(apigen.DashboardProblem{Kind: apigen.NoLink, Severity: apigen.DashboardProblemSeverityInfo, Count: int(counts.NoLink)})
	}
	if counts.NoMgmt > 0 {
		add(apigen.DashboardProblem{Kind: apigen.NoMgmt, Severity: apigen.DashboardProblemSeverityInfo, Count: int(counts.NoMgmt)})
	}
	return append(append(append([]apigen.DashboardProblem{}, errs...), warns...), infos...), nil
}
