package auth

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// cheapArgon keeps tests fast; production uses DefaultArgon2.
var cheapArgon = Argon2Params{MemoryKiB: 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery", cheapArgon)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=1024,t=1,p=1$") {
		t.Fatalf("unexpected PHC format: %s", hash)
	}
	if ok, err := VerifyPassword("correct horse battery", hash); err != nil || !ok {
		t.Fatalf("correct password rejected: ok=%v err=%v", ok, err)
	}
	if ok, _ := VerifyPassword("wrong password", hash); ok {
		t.Fatal("wrong password accepted")
	}
	other, _ := HashPassword("correct horse battery", cheapArgon)
	if other == hash {
		t.Fatal("same password produced identical hashes (salt not random)")
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	for _, bad := range []string{"", "plaintext", "$argon2i$v=19$m=1,t=1,p=1$a$b", "$argon2id$v=1$m=1,t=1,p=1$a$b"} {
		if _, err := VerifyPassword("x", bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestTokens(t *testing.T) {
	a, _ := NewToken()
	b, _ := NewToken()
	if a == b || len(a) < 40 {
		t.Fatalf("tokens not random/long enough: %q %q", a, b)
	}
	if string(HashToken(a)) == a || len(HashToken(a)) != 32 {
		t.Fatal("HashToken must return a 32-byte digest, not the token")
	}
}

func TestClientIPIgnoresForwardedHeaderFromUntrustedPeer(t *testing.T) {
	r, _ := NewClientIPResolver("10.0.0.0/8")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.7:5555"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := r.Resolve(req).String(); got != "203.0.113.7" {
		t.Fatalf("spoofed header trusted: got %s", got)
	}
}

func TestClientIPUsesRightmostUntrustedHop(t *testing.T) {
	r, _ := NewClientIPResolver("172.16.0.0/12,127.0.0.1/32")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "172.18.0.5:40000" // nginx container
	// Client prepended a fake hop; nginx appended the real client address.
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.20")
	if got := r.Resolve(req).String(); got != "198.51.100.20" {
		t.Fatalf("got %s, want 198.51.100.20", got)
	}
}

func TestClientIPMalformedHeaderFallsBackToPeer(t *testing.T) {
	r, _ := NewClientIPResolver("127.0.0.1/32")
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "not-an-ip")
	if got := r.Resolve(req).String(); got != "127.0.0.1" {
		t.Fatalf("got %s, want peer 127.0.0.1", got)
	}
}

func TestIsSecureOnlyFromTrustedProxy(t *testing.T) {
	r, _ := NewClientIPResolver("127.0.0.1/32")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.RemoteAddr = "127.0.0.1:1"
	if !r.IsSecure(req) {
		t.Fatal("trusted proxy https not honoured")
	}
	req.RemoteAddr = "203.0.113.1:1"
	if r.IsSecure(req) {
		t.Fatal("untrusted X-Forwarded-Proto honoured")
	}
	r.ForceSecure = true // NTB_COOKIE_SECURE
	if !r.IsSecure(req) {
		t.Fatal("ForceSecure ignored")
	}
}

func TestInvalidTrustedProxyCIDR(t *testing.T) {
	if _, err := NewClientIPResolver("10.0.0.0/8,banana"); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestRateLimiterWindow(t *testing.T) {
	now := time.Unix(0, 0)
	rl := NewRateLimiter(2, time.Minute)
	rl.now = func() time.Time { return now }
	for i := 1; i <= 2; i++ {
		if !rl.Allow("k") {
			t.Fatalf("event %d should pass", i)
		}
	}
	if rl.Allow("k") {
		t.Fatal("third event in the window should be limited")
	}
	if !rl.Allow("other") {
		t.Fatal("keys must be independent")
	}
	now = now.Add(time.Minute)
	if !rl.Allow("k") {
		t.Fatal("new window should reset the count")
	}
}
