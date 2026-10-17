// Package ntbschema validates .ntb.json files (P1-22, ADR-037) against schema/ntb.schema.json — embedded here as a
// copy; a test keeps the copy identical to the repository's single source.
package ntbschema

import (
	"bytes"
	_ "embed"
	"fmt"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed ntb.schema.json
var Raw []byte

var (
	once     sync.Once
	compiled *jsonschema.Schema
	compErr  error
)

func schema() (*jsonschema.Schema, error) {
	once.Do(func() {
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(Raw))
		if err != nil {
			compErr = fmt.Errorf("parse ntb schema: %w", err)
			return
		}
		c := jsonschema.NewCompiler()
		if err := c.AddResource("ntb.schema.json", doc); err != nil {
			compErr = fmt.Errorf("add ntb schema: %w", err)
			return
		}
		compiled, compErr = c.Compile("ntb.schema.json")
	})
	return compiled, compErr
}

// Validate checks a JSON document; the error says where the file is wrong (shown to the user).
func Validate(data []byte) error {
	s, err := schema()
	if err != nil {
		return err
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("không đọc được JSON: %w", err)
	}
	if err := s.Validate(inst); err != nil {
		return err
	}
	return nil
}
