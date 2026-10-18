package backup

import (
	"bytes"
	"crypto/rand"
	"errors"
	"testing"
)

func seal(t *testing.T, data []byte, pass string) []byte {
	t.Helper()
	var out bytes.Buffer
	e, err := NewEncrypter(&out, pass, Meta{Kind: "manual", SchemaVersion: 28, KeyFingerprint: "abc"})
	if err != nil {
		t.Fatal(err)
	}
	// Odd write sizes cross chunk boundaries.
	for p := data; len(p) > 0; {
		k := min(len(p), 10_000)
		if _, err := e.Write(p[:k]); err != nil {
			t.Fatal(err)
		}
		p = p[k:]
	}
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestRoundTrip(t *testing.T) {
	for _, size := range []int{0, 1, chunkSize - 1, chunkSize, chunkSize + 1, 3 * chunkSize, 3*chunkSize + 77} {
		data := make([]byte, size)
		_, _ = rand.Read(data)
		file := seal(t, data, "đúng mật khẩu sao lưu")
		var got bytes.Buffer
		meta, err := Decrypt(&got, bytes.NewReader(file), "đúng mật khẩu sao lưu")
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		if !bytes.Equal(got.Bytes(), data) || meta.SchemaVersion != 28 || meta.KeyFingerprint != "abc" {
			t.Fatalf("size %d: round trip differs (meta %+v)", size, meta)
		}
		// The metadata reads without the passphrase.
		if m, err := ReadMeta(bytes.NewReader(file)); err != nil || m.Kind != "manual" {
			t.Fatalf("size %d: meta %v %+v", size, err, m)
		}
	}
}

func TestRefusals(t *testing.T) {
	data := make([]byte, 3*chunkSize+500)
	_, _ = rand.Read(data)
	file := seal(t, data, "pass-phrase-0123456")
	headerEnd := len(file) - (3*(chunkSize+tagSize) + 500 + tagSize)
	cases := map[string]struct {
		file []byte
		pass string
		want error
	}{
		"wrong passphrase": {file, "other-phrase-0123456", ErrPassphrase},
		"flipped byte":     {flip(file, len(file)-100), "pass-phrase-0123456", ErrPassphrase},
		"cut in a chunk":   {file[:len(file)-200], "pass-phrase-0123456", ErrPassphrase},
		"cut on a chunk":   {file[:headerEnd+2*(chunkSize+tagSize)], "pass-phrase-0123456", ErrTruncated},
		"header only":      {file[:headerEnd], "pass-phrase-0123456", ErrTruncated},
		"data appended":    {append(append([]byte{}, file...), 'x'), "pass-phrase-0123456", ErrPassphrase},
		"header edited":    {flip(file, 20), "pass-phrase-0123456", nil}, // either unreadable header or failed chunks
	}
	for name, c := range cases {
		_, err := Decrypt(&bytes.Buffer{}, bytes.NewReader(c.file), c.pass)
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if c.want != nil && !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
	if _, err := NewEncrypter(&bytes.Buffer{}, "short", Meta{}); err == nil {
		t.Error("short passphrase accepted")
	}
}

func flip(b []byte, i int) []byte {
	c := append([]byte{}, b...)
	c[i] ^= 0x40
	return c
}
