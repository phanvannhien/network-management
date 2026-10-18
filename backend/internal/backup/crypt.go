// Package backup makes, checks and restores encrypted backups of the database (P2-13, ADR-053).
package backup

import (
	"bufio"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

// File format (ADR-053), streaming so a dump of any size never sits in memory:
//
//	magic "NTBBAK\x00\x01" (8) | header length u32 | header JSON | chunks…
//
// The header holds the KDF parameters, the salt, the nonce prefix and the backup's metadata in clear text (what a
// file is can be read without the passphrase). Every chunk is AES-256-GCM over ≤ 64 KiB of the dump with
//
//	nonce = prefix (7 bytes) | chunk counter u32 | last flag (1 byte)
//	aad   = SHA-256(magic | header length | header JSON)
//
// (the STREAM construction): chunks cannot be reordered, dropped or swapped between files, the header cannot be
// edited, and a file cut short is refused because its last chunk (flag 1) never comes.

var magic = []byte("NTBBAK\x00\x01")

// MinPassphrase is the shortest backup passphrase accepted (it guards a copy of everything).
const MinPassphrase = 16

const (
	chunkSize    = 64 << 10
	tagSize      = 16
	prefixSize   = 7
	maxHeader    = 64 << 10
	defaultTime  = 3
	defaultMemKB = 64 << 10 // 64 MiB
	defaultLanes = 4
)

// Meta describes a backup; it is stored in clear in the file header.
type Meta struct {
	CreatedAt     string `json:"createdAt"`
	Kind          string `json:"kind"` // scheduled, manual, pre-upgrade, pre-restore
	AppVersion    string `json:"appVersion"`
	SchemaVersion uint   `json:"schemaVersion"`
	Database      string `json:"database"`
	ServerVersion string `json:"serverVersion"`
	// KeyFingerprint names the master key the secrets inside were sealed with (never the key itself).
	KeyFingerprint string `json:"keyFingerprint"`
	KeyVersion     int16  `json:"keyVersion"`
}

type header struct {
	Format int    `json:"format"`
	KDF    string `json:"kdf"`
	Time   uint32 `json:"t"`
	MemKB  uint32 `json:"m"`
	Lanes  uint8  `json:"p"`
	Salt   []byte `json:"salt"`
	Prefix []byte `json:"noncePrefix"`
	Chunk  int    `json:"chunk"`
	Meta   Meta   `json:"meta"`
}

// ErrPassphrase means the passphrase does not open the file (or the file was altered).
var ErrPassphrase = errors.New("backup: wrong passphrase or damaged file")

// ErrTruncated means the file ends before its last chunk.
var ErrTruncated = errors.New("backup: file is incomplete (cut short)")

func deriveKey(passphrase string, h header) []byte {
	return argon2.IDKey([]byte(passphrase), h.Salt, h.Time, h.MemKB, h.Lanes, 32)
}

func nonceFor(prefix []byte, counter uint32, last bool) []byte {
	n := make([]byte, 0, 12)
	n = append(n, prefix...)
	n = binary.BigEndian.AppendUint32(n, counter)
	if last {
		return append(n, 1)
	}
	return append(n, 0)
}

// Encrypter is an io.WriteCloser: write the dump, Close to seal the last chunk.
type Encrypter struct {
	w       io.Writer
	aead    cipher.AEAD
	prefix  []byte
	aad     []byte
	buf     []byte
	counter uint32
	closed  bool
}

// NewEncrypter writes the file header to w and returns the writer for the dump.
func NewEncrypter(w io.Writer, passphrase string, meta Meta) (*Encrypter, error) {
	if len([]rune(passphrase)) < MinPassphrase {
		return nil, fmt.Errorf("backup: the passphrase needs at least %d characters", MinPassphrase)
	}
	h := header{Format: 1, KDF: "argon2id", Time: defaultTime, MemKB: defaultMemKB, Lanes: defaultLanes, Chunk: chunkSize, Meta: meta,
		Salt: make([]byte, 16), Prefix: make([]byte, prefixSize)}
	if _, err := rand.Read(h.Salt); err != nil {
		return nil, fmt.Errorf("backup salt: %w", err)
	}
	if _, err := rand.Read(h.Prefix); err != nil {
		return nil, fmt.Errorf("backup nonce prefix: %w", err)
	}
	head, err := json.Marshal(h)
	if err != nil {
		return nil, fmt.Errorf("backup header: %w", err)
	}
	pre := append(append([]byte{}, magic...), binary.BigEndian.AppendUint32(nil, uint32(len(head)))...)
	pre = append(pre, head...)
	if _, err := w.Write(pre); err != nil {
		return nil, fmt.Errorf("write backup header: %w", err)
	}
	aead, err := newAEAD(deriveKey(passphrase, h))
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(pre)
	return &Encrypter{w: w, aead: aead, prefix: h.Prefix, aad: sum[:], buf: make([]byte, 0, chunkSize)}, nil
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("backup cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("backup gcm: %w", err)
	}
	return aead, nil
}

func (e *Encrypter) seal(last bool) error {
	if e.counter == ^uint32(0) {
		return errors.New("backup: too large")
	}
	out := e.aead.Seal(nil, nonceFor(e.prefix, e.counter, last), e.buf, e.aad)
	e.counter++
	e.buf = e.buf[:0]
	if _, err := e.w.Write(out); err != nil {
		return fmt.Errorf("write backup chunk: %w", err)
	}
	return nil
}

func (e *Encrypter) Write(p []byte) (int, error) {
	if e.closed {
		return 0, errors.New("backup: write after close")
	}
	n := 0
	for len(p) > 0 {
		// A full buffer is sealed only when more data follows, so the last chunk is never a full one followed by
		// nothing — Close always has the final chunk to seal.
		if len(e.buf) == chunkSize {
			if err := e.seal(false); err != nil {
				return n, err
			}
		}
		k := min(chunkSize-len(e.buf), len(p))
		e.buf = append(e.buf, p[:k]...)
		p = p[k:]
		n += k
	}
	return n, nil
}

// Close seals the last chunk (possibly empty). Without it the file is refused as incomplete.
func (e *Encrypter) Close() error {
	if e.closed {
		return nil
	}
	e.closed = true
	return e.seal(true)
}

// ReadMeta reads a file's header without the passphrase.
func ReadMeta(r io.Reader) (Meta, error) {
	h, _, err := readHeader(r)
	return h.Meta, err
}

func readHeader(r io.Reader) (header, []byte, error) {
	var h header
	pre := make([]byte, len(magic)+4)
	if _, err := io.ReadFull(r, pre); err != nil {
		return h, nil, fmt.Errorf("backup: not a backup file: %w", err)
	}
	if !bytes.Equal(pre[:len(magic)], magic) {
		return h, nil, errors.New("backup: not a backup file (or a newer format)")
	}
	n := binary.BigEndian.Uint32(pre[len(magic):])
	if n == 0 || n > maxHeader {
		return h, nil, errors.New("backup: bad header")
	}
	head := make([]byte, n)
	if _, err := io.ReadFull(r, head); err != nil {
		return h, nil, fmt.Errorf("backup header: %w", err)
	}
	if err := json.Unmarshal(head, &h); err != nil {
		return h, nil, fmt.Errorf("backup header: %w", err)
	}
	// Refuse parameters that would make the KDF a denial of service or the format ambiguous.
	if h.Format != 1 || h.KDF != "argon2id" || len(h.Salt) < 16 || len(h.Prefix) != prefixSize || h.Chunk != chunkSize ||
		h.Time < 1 || h.Time > 20 || h.MemKB < 8<<10 || h.MemKB > 1<<20 || h.Lanes < 1 || h.Lanes > 16 {
		return h, nil, errors.New("backup: unsupported header parameters")
	}
	return h, append(pre, head...), nil
}

// Decrypt copies the dump inside an encrypted file to w and returns the file's metadata. It fails on a wrong
// passphrase, an altered or truncated file, or data after the end.
func Decrypt(w io.Writer, r io.Reader, passphrase string) (Meta, error) {
	br := bufio.NewReaderSize(r, chunkSize+tagSize)
	h, pre, err := readHeader(br)
	if err != nil {
		return Meta{}, err
	}
	aead, err := newAEAD(deriveKey(passphrase, h))
	if err != nil {
		return h.Meta, err
	}
	sum := sha256.Sum256(pre)
	buf := make([]byte, chunkSize+tagSize)
	for counter := uint32(0); ; counter++ {
		n, err := io.ReadFull(br, buf)
		if errors.Is(err, io.EOF) {
			return h.Meta, ErrTruncated
		}
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
			return h.Meta, fmt.Errorf("read backup chunk: %w", err)
		}
		// A full-size chunk followed by more data is a middle chunk; anything else must be the last one.
		last := n < len(buf)
		if !last {
			if _, perr := br.Peek(1); errors.Is(perr, io.EOF) {
				last = true
			}
		}
		plain, oerr := aead.Open(buf[:0:0], nonceFor(h.Prefix, counter, last), buf[:n], sum[:])
		if oerr != nil {
			if last {
				// A middle chunk opened as "last" fails: the file was cut on a chunk boundary.
				if _, merr := aead.Open(nil, nonceFor(h.Prefix, counter, false), buf[:n], sum[:]); merr == nil {
					return h.Meta, ErrTruncated
				}
			}
			return h.Meta, ErrPassphrase
		}
		if _, err := w.Write(plain); err != nil {
			return h.Meta, fmt.Errorf("write decrypted backup: %w", err)
		}
		if last {
			return h.Meta, nil
		}
	}
}
