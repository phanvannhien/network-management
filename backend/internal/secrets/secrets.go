// Package secrets implements envelope encryption for stored secrets (TOTP seeds now; device credentials,
// cloud accounts and SNMP communities in Phase 2/3 — ADR-018, CLAUDE.md "Bí mật").
//
// Each secret gets its own random data key (DEK); the plaintext is sealed with AES-256-GCM under the DEK,
// and the DEK is sealed with AES-256-GCM under the master key from NTB_MASTER_KEY. Only ciphertext,
// the wrapped DEK and the master-key version are stored, so rotating the master key means re-wrapping
// DEKs, not re-encrypting every secret.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// KeySize is the master key and DEK length (AES-256).
const KeySize = 32

// Sealed is what gets persisted for one secret. None of it is sensitive without the master key.
type Sealed struct {
	Ciphertext []byte // nonce || AES-GCM(DEK, plaintext)
	WrappedDEK []byte // nonce || AES-GCM(master, DEK)
	KeyVersion int16  // which master key wrapped the DEK
}

// Keyring holds the current master key. (Rotation: older versions will be added here in Phase 2.)
type Keyring struct {
	current []byte
	version int16
}

// ErrDecrypt is returned for any authentication failure, without detail (no oracle for attackers).
var ErrDecrypt = errors.New("secret decryption failed")

// ParseMasterKey decodes a base64 32-byte key (generate with `openssl rand -base64 32`).
func ParseMasterKey(encoded string) ([]byte, error) {
	encoded = strings.TrimSpace(encoded)
	if encoded == "" {
		return nil, errors.New("NTB_MASTER_KEY is not set (generate one with: openssl rand -base64 32)")
	}
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("NTB_MASTER_KEY is not valid base64")
	}
	if len(key) != KeySize {
		return nil, fmt.Errorf("NTB_MASTER_KEY must decode to %d bytes, got %d", KeySize, len(key))
	}
	return key, nil
}

// NewKeyring wraps a 32-byte master key as version 1.
func NewKeyring(master []byte) (*Keyring, error) {
	return NewKeyringVersion(master, 1)
}

// NewKeyringVersion wraps a master key with its version (NTB_MASTER_KEY_VERSION; bumped by each rotation).
func NewKeyringVersion(master []byte, version int16) (*Keyring, error) {
	if len(master) != KeySize {
		return nil, fmt.Errorf("master key must be %d bytes", KeySize)
	}
	if version < 1 {
		return nil, fmt.Errorf("master key version must be ≥ 1, got %d", version)
	}
	k := make([]byte, KeySize)
	copy(k, master)
	return &Keyring{current: k, version: version}, nil
}

// Version is the master key version new secrets are wrapped with.
func (k *Keyring) Version() int16 { return k.version }

// Rewrap moves a secret from this keyring to next (master key rotation): only the data key is unwrapped and
// wrapped again; the secret's ciphertext does not change and the plaintext is never handled.
func (k *Keyring) Rewrap(s Sealed, aad []byte, next *Keyring) (Sealed, error) {
	if s.KeyVersion != k.version {
		return Sealed{}, ErrDecrypt
	}
	dek, err := gcmOpen(k.current, s.WrappedDEK, aad)
	if err != nil {
		return Sealed{}, ErrDecrypt
	}
	wrapped, err := gcmSeal(next.current, dek, aad)
	if err != nil {
		return Sealed{}, err
	}
	return Sealed{Ciphertext: s.Ciphertext, WrappedDEK: wrapped, KeyVersion: next.version}, nil
}

// Seal encrypts plaintext under a fresh DEK. aad binds the ciphertext to its context (e.g. "totp:<user id>")
// so a sealed value cannot be copied onto another row and still decrypt.
func (k *Keyring) Seal(plaintext, aad []byte) (Sealed, error) {
	dek := make([]byte, KeySize)
	if _, err := rand.Read(dek); err != nil {
		return Sealed{}, fmt.Errorf("generate data key: %w", err)
	}
	ct, err := gcmSeal(dek, plaintext, aad)
	if err != nil {
		return Sealed{}, err
	}
	wrapped, err := gcmSeal(k.current, dek, aad)
	if err != nil {
		return Sealed{}, err
	}
	return Sealed{Ciphertext: ct, WrappedDEK: wrapped, KeyVersion: k.version}, nil
}

// Open decrypts a Sealed value; aad must match what was used to Seal.
func (k *Keyring) Open(s Sealed, aad []byte) ([]byte, error) {
	if s.KeyVersion != k.version {
		return nil, ErrDecrypt
	}
	dek, err := gcmOpen(k.current, s.WrappedDEK, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	pt, err := gcmOpen(dek, s.Ciphertext, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

func gcmSeal(key, plaintext, aad []byte) ([]byte, error) {
	aead, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}
	return aead.Seal(nonce, nonce, plaintext, aad), nil
}

func gcmOpen(key, sealed, aad []byte) ([]byte, error) {
	aead, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(sealed) < aead.NonceSize() {
		return nil, ErrDecrypt
	}
	nonce, ct := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	return aead.Open(nil, nonce, ct, aad)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}
	return aead, nil
}

// Fingerprint names a master key without revealing it (backup files record it so a restore can tell whether the
// current key opens their secrets): the first 8 bytes of HMAC-SHA256(key, label), hex.
func Fingerprint(master []byte) string {
	m := hmac.New(sha256.New, master)
	m.Write([]byte("ntb-backup-key-fingerprint-v1"))
	return hex.EncodeToString(m.Sum(nil)[:8])
}
