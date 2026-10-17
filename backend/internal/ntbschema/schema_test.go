package ntbschema

import (
	"bytes"
	"os"
	"testing"
)

// The embedded copy must be the repository's schema/ntb.schema.json (single source for FE + BE).
func TestEmbeddedCopyIsTheSource(t *testing.T) {
	src, err := os.ReadFile("../../../schema/ntb.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(src, Raw) {
		t.Fatal("backend/internal/ntbschema/ntb.schema.json differs from schema/ntb.schema.json — copy it again")
	}
	if _, err := schema(); err != nil {
		t.Fatal(err)
	}
}

func TestValidate(t *testing.T) {
	ok := `{"schemaVersion":"2.0.0","exportedAt":"2026-10-17T00:00:00Z","diagram":{"name":"D","layer":"physical","view":{"nodes":[],"edges":[],"annotations":[]}},
	"sites":[],"devices":[],"interfaces":[],"ips":[],"links":[],"clusters":[],"endpointGroups":[],"subnets":[],"ranges":[]}`
	if err := Validate([]byte(ok)); err != nil {
		t.Errorf("minimal file: %v", err)
	}
	bad := `{"schemaVersion":"2.0.0","exportedAt":"x","diagram":{"name":"D","layer":"physical","view":{"nodes":[],"edges":[],"annotations":[]}},
	"sites":[],"devices":[{"ref":"d1","siteRef":"s1","hostname":"X","type":"toaster"}],"interfaces":[],"ips":[],"links":[],"clusters":[],"endpointGroups":[],"subnets":[],"ranges":[],"password":"x"}`
	if err := Validate([]byte(bad)); err == nil {
		t.Error("unknown type and extra property accepted")
	}
}
