package auth

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ClientIPResolver finds the real client address. X-Forwarded-For is honoured only when the direct peer
// is a trusted proxy (e.g. our nginx), and then the rightmost untrusted hop is used — the client cannot
// spoof it by sending its own header (the reason chi's RealIP was dropped in P0-01).
type ClientIPResolver struct {
	trusted []netip.Prefix
}

// NewClientIPResolver parses a comma-separated CIDR list such as "127.0.0.1/32,172.16.0.0/12".
func NewClientIPResolver(cidrs string) (*ClientIPResolver, error) {
	r := &ClientIPResolver{}
	for _, raw := range strings.Split(cidrs, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(raw)
		if err != nil {
			return nil, fmt.Errorf("parse trusted proxy %q: %w", raw, err)
		}
		r.trusted = append(r.trusted, prefix.Masked())
	}
	return r, nil
}

// Resolve returns the client IP for r, or an invalid Addr when it cannot be determined.
func (c *ClientIPResolver) Resolve(r *http.Request) netip.Addr {
	peer := parseHostAddr(r.RemoteAddr)
	if !peer.IsValid() || !c.isTrusted(peer) {
		return peer
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break // malformed header: stop trusting it
		}
		addr = addr.Unmap()
		if !c.isTrusted(addr) {
			return addr
		}
	}
	return peer
}

// IsSecure reports whether the original request used HTTPS (directly or via a trusted proxy).
func (c *ClientIPResolver) IsSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	peer := parseHostAddr(r.RemoteAddr)
	return peer.IsValid() && c.isTrusted(peer) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (c *ClientIPResolver) isTrusted(addr netip.Addr) bool {
	for _, p := range c.trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func parseHostAddr(hostport string) netip.Addr {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return addr.Unmap()
}
