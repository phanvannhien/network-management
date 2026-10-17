package api

import (
	"context"
	"fmt"
	"net/netip"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/tenant"
)

// Uniqueness refused on write (ADR-038): a serial number is one box; an address is one owner in its VRF, except the
// copies that are right by design. Both checks lock the value for the rest of the transaction first, so two
// concurrent writes of the same value cannot both pass.

// placeholderSerials are what people type when the serial is unknown: never a clash.
var placeholderSerials = map[string]bool{"": true, "-": true, "n/a": true, "na": true, "none": true, "unknown": true, "tbd": true, "0": true}

// serialTaken returns why the serial cannot be used by device self (Valid = an update), or "" when it is free.
// Retired devices keep their serial without blocking (the box may come back as a new record).
func serialTaken(ctx context.Context, q store.Querier, m tenant.Membership, serial, lifecycle string, self pgtype.UUID) (string, error) {
	norm := strings.ToLower(strings.TrimSpace(serial))
	if placeholderSerials[norm] || lifecycle == "retired" {
		return "", nil
	}
	if err := q.LockValue(ctx, uuidStr(m.OrgID)+"|serial|"+norm); err != nil {
		return "", fmt.Errorf("lock serial: %w", err)
	}
	rows, err := q.SerialHolders(ctx, store.SerialHoldersParams{OrganizationID: m.OrgID, Serial: norm, Self: self})
	if err != nil {
		return "", fmt.Errorf("serial holders: %w", err)
	}
	if len(rows) == 0 {
		return "", nil
	}
	return fmt.Sprintf("S/N %s đã thuộc thiết bị %s — mỗi thiết bị thật có một S/N riêng", strings.TrimSpace(serial), rows[0].Hostname), nil
}

// addrClaim is an address about to be written, with who would hold it.
type addrClaim struct {
	vrf       string
	host      netip.Addr
	role      string      // primary, secondary, nat, public, vip
	device    pgtype.UUID // the device holding it (interface / NAT address)
	cluster   pgtype.UUID // the device's cluster, or the cluster whose shared IP it is
	member    pgtype.UUID // an endpoint group member
	self      pgtype.UUID // the ip_addresses row being edited
	lifecycle string      // the device's; "" for clusters and members (in use)
}

// inUse: planned / spare / RMA kit may carry the address of the box it replaces (warned by the checks, not refused).
func inUse(lifecycle string) bool { return lifecycle == "" || lifecycle == "active" }

// addressTaken returns why the address cannot be written, or "" when it is free or shared by design: same device or
// cluster (members and their shared IP are one owner, ADR-027), a NAT / public copy (PAT behind one WAN IP), VRRP /
// HSRP virtual IPs on both sides, kit not in use, IPv6 link-local.
func addressTaken(ctx context.Context, q store.Querier, m tenant.Membership, c addrClaim) (string, error) {
	host := c.host.Unmap()
	if host.IsLinkLocalUnicast() || c.role == "nat" || c.role == "public" || !inUse(c.lifecycle) {
		return "", nil
	}
	if err := q.LockValue(ctx, uuidStr(m.OrgID)+"|ip|"+c.vrf+"|"+host.String()); err != nil {
		return "", fmt.Errorf("lock address: %w", err)
	}
	rows, err := q.AddressHolders(ctx, store.AddressHoldersParams{OrganizationID: m.OrgID, Vrf: c.vrf, Host: host})
	if err != nil {
		return "", fmt.Errorf("address holders: %w", err)
	}
	for _, h := range rows {
		switch {
		case c.self.Valid && h.Kind == "ip" && h.ID == c.self,
			c.member.Valid && h.MemberID == c.member,
			c.device.Valid && h.DeviceID == c.device,
			c.cluster.Valid && h.ClusterID == c.cluster,
			h.Role == "nat" || h.Role == "public",
			h.Role == "vip" && c.role == "vip",
			!inUse(h.Lifecycle):
			continue
		}
		where := h.Name
		if h.InterfaceName != "" {
			where += " (" + h.InterfaceName + ")"
		}
		vrf := ""
		if c.vrf != "" {
			vrf = " trong VRF " + c.vrf
		}
		hint := ""
		if h.Role == "vip" || c.role == "vip" {
			hint = " — IP ảo VRRP/HSRP dùng chung thì mọi bản phải có vai trò VIP"
		}
		return fmt.Sprintf("IP %s%s đã dùng ở %s%s", host, vrf, where, hint), nil
	}
	return "", nil
}
