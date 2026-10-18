package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testdataDir is the repo-root /testdata, resolved relative to this file.
const testdataDir = "../../../testdata"

// TestRoundTripWithTestdata unmarshals every v1 sample in /testdata/legacy and re-marshals it,
// requiring the result to be byte-identical to the input (modulo key order and
// trailing newline). This keeps the Go structs in sync with ntb.schema.json.
func TestRoundTripWithTestdata(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(testdataDir, "legacy", "*.ntb.json"))
	if err != nil {
		t.Fatalf("glob testdata: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no *.ntb.json files found in /testdata")
	}

	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("read file: %v", err)
			}

			f, err := Parse(raw)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}

			out, err := json.Marshal(f)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}

			// Compare semantically: re-normalize both through generic decode/encode
			// so key order and whitespace differences don't matter.
			var want, got any
			if err := json.Unmarshal(raw, &want); err != nil {
				t.Fatalf("normalize input: %v", err)
			}
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatalf("normalize output: %v", err)
			}
			wantBytes, _ := json.Marshal(want)
			gotBytes, _ := json.Marshal(got)
			if !bytes.Equal(wantBytes, gotBytes) {
				t.Errorf("round-trip mismatch\nwant: %s\ngot:  %s",
					clip(string(wantBytes), 2000), clip(string(gotBytes), 2000))
			}
		})
	}
}

// TestSchemaVersionIsKnown guards against accidentally loading files from an
// unsupported future schema without migration.
func TestSchemaVersionIsKnown(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(testdataDir, "*.ntb.json"))
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		f, err := Parse(raw)
		if err != nil {
			t.Fatalf("parse %s: %v", file, err)
		}
		if f.SchemaVersion != "1.0.0" {
			t.Errorf("%s: unsupported schemaVersion %q", file, f.SchemaVersion)
		}
	}
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n]) + "…"
}
