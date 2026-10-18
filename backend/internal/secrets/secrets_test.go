package secrets

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
)

func testKeyring(t *testing.T) *Keyring {
	t.Helper()
	key := make([]byte, KeySize)
	_, _ = rand.Read(key)
	k, err := NewKeyring(key)
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	return k
}

func TestSealOpenRoundTrip(t *testing.T) {
	k := testKeyring(t)
	s, err := k.Seal([]byte("JBSWY3DPEHPK3PXP"), []byte("totp:user-1"))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if bytes.Contains(s.Ciphertext, []byte("JBSWY3DPEHPK3PXP")) {
		t.Fatal("plaintext visible in ciphertext")
	}
	got, err := k.Open(s, []byte("totp:user-1"))
	if err != nil || string(got) != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("open: %q %v", got, err)
	}
}

func TestEachSealUsesFreshKeyAndNonce(t *testing.T) {
	k := testKeyring(t)
	a, _ := k.Seal([]byte("same"), nil)
	b, _ := k.Seal([]byte("same"), nil)
	if bytes.Equal(a.Ciphertext, b.Ciphertext) || bytes.Equal(a.WrappedDEK, b.WrappedDEK) {
		t.Fatal("identical plaintexts produced identical sealed values")
	}
}

func TestOpenFailsOnTamperingWrongAADOrWrongKey(t *testing.T) {
	k := testKeyring(t)
	s, _ := k.Seal([]byte("secret"), []byte("totp:user-1"))

	if _, err := k.Open(s, []byte("totp:user-2")); !errors.Is(err, ErrDecrypt) {
		t.Fatal("value copied to another user's row decrypted")
	}
	tampered := s
	tampered.Ciphertext = append([]byte(nil), s.Ciphertext...)
	tampered.Ciphertext[len(tampered.Ciphertext)-1] ^= 1
	if _, err := k.Open(tampered, []byte("totp:user-1")); !errors.Is(err, ErrDecrypt) {
		t.Fatal("tampered ciphertext accepted")
	}
	if _, err := testKeyring(t).Open(s, []byte("totp:user-1")); !errors.Is(err, ErrDecrypt) {
		t.Fatal("decrypted with a different master key")
	}
	wrongVersion := s
	wrongVersion.KeyVersion = 2
	if _, err := k.Open(wrongVersion, []byte("totp:user-1")); !errors.Is(err, ErrDecrypt) {
		t.Fatal("unknown key version accepted")
	}
}

func TestParseMasterKey(t *testing.T) {
	good := base64.StdEncoding.EncodeToString(make([]byte, KeySize))
	if _, err := ParseMasterKey(good); err != nil {
		t.Fatalf("valid key rejected: %v", err)
	}
	for name, bad := range map[string]string{
		"empty":      "",
		"not base64": "!!!not-base64!!!",
		"too short":  base64.StdEncoding.EncodeToString(make([]byte, 16)),
	} {
		if _, err := ParseMasterKey(bad); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestRewrapMovesToTheNextKey(t *testing.T) {
	old := testKeyring(t)
	next, err := NewKeyringVersion(bytes.Repeat([]byte{9}, KeySize), 2)
	if err != nil {
		t.Fatal(err)
	}
	aad := []byte("credential:1")
	sealed, err := old.Seal([]byte("s3cret"), aad)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := old.Rewrap(sealed, aad, next)
	if err != nil {
		t.Fatal(err)
	}
	if moved.KeyVersion != 2 || !bytes.Equal(moved.Ciphertext, sealed.Ciphertext) {
		t.Fatalf("rewrapped: %+v", moved)
	}
	if pt, err := next.Open(moved, aad); err != nil || string(pt) != "s3cret" {
		t.Fatalf("open with the new key: %q %v", pt, err)
	}
	if _, err := old.Open(moved, aad); err == nil {
		t.Error("the old key still opens it")
	}
	if _, err := old.Rewrap(sealed, []byte("credential:2"), next); err == nil {
		t.Error("rewrap with another row's aad")
	}
}
