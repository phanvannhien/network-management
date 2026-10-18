// Package catalog is the built-in device catalog (ADR-035): common network products with their real port layout,
// shipped in the binary, read only, the same for every organization. Organizations copy an entry into their own
// templates before using it.
package catalog

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
)

//go:embed data/*.json
var data embed.FS

// Photos (P2-12): images/<id>.front.jpg / <id>.rear.jpg, from the NetBox device type library (CC0); SOURCES.json
// gives the page each one comes from, and the sibling model it shows when the model itself has no photo.
//
//go:embed images
var images embed.FS

var (
	once    sync.Once
	models  []apigen.CatalogModel
	byID    map[string]int
	loadErr error
)

// All returns every catalog model, sorted by vendor then model. The data is checked once (tests run Load).
func All() []apigen.CatalogModel {
	once.Do(load)
	return models
}

// Get returns the model with this id.
func Get(id string) (apigen.CatalogModel, bool) {
	once.Do(load)
	i, ok := byID[id]
	if !ok {
		return apigen.CatalogModel{}, false
	}
	return models[i], true
}

// Image returns a photo by file name ("<id>.front.jpg").
func Image(file string) ([]byte, bool) {
	once.Do(load)
	if !imageRe.MatchString(file) {
		return nil, false
	}
	b, err := images.ReadFile("images/" + file)
	return b, err == nil
}

// Load parses the embedded files and reports the first problem (used by tests and at startup).
func Load() error {
	once.Do(load)
	return loadErr
}

var (
	idRe    = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9.]+)*$`)
	imageRe = regexp.MustCompile(`^([a-z0-9][a-z0-9.-]*)\.(front|rear)\.jpg$`)
)

func load() {
	byID = map[string]int{}
	files, err := fs.Glob(data, "data/*.json")
	if err != nil {
		loadErr = fmt.Errorf("list catalog files: %w", err)
		return
	}
	for _, f := range files {
		raw, err := data.ReadFile(f)
		if err != nil {
			loadErr = fmt.Errorf("read %s: %w", f, err)
			return
		}
		var doc struct {
			Models []apigen.CatalogModel `json:"models"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			loadErr = fmt.Errorf("parse %s: %w", f, err)
			return
		}
		for _, m := range doc.Models {
			_, dup := byID[m.Id]
			switch {
			case !idRe.MatchString(m.Id):
				loadErr = fmt.Errorf("%s: bad id %q", f, m.Id)
			case dup:
				loadErr = fmt.Errorf("%s: duplicate id %q", f, m.Id)
			case !m.Type.Valid():
				loadErr = fmt.Errorf("%s: %s has unknown type %q", f, m.Id, m.Type)
			case strings.TrimSpace(m.Model) == "" || strings.TrimSpace(m.Vendor) == "":
				loadErr = fmt.Errorf("%s: %s needs vendor and model", f, m.Id)
			case len(m.Ports) == 0:
				loadErr = fmt.Errorf("%s: %s has no ports", f, m.Id)
			}
			if loadErr != nil {
				return
			}
			if m.UHeight < 1 {
				m.UHeight = 1
			}
			if m.PartNumbers == nil {
				m.PartNumbers = []string{}
			}
			if m.Aliases == nil {
				m.Aliases = []string{}
			}
			var n int32
			for _, g := range m.Ports {
				n += g.Count
			}
			m.PortCount = n
			m.Images = apigen.CatalogImages{}
			byID[m.Id] = len(models)
			models = append(models, m)
		}
	}
	if loadErr = attachImages(); loadErr != nil {
		return
	}
	slices.SortFunc(models, func(a, b apigen.CatalogModel) int {
		return strings.Compare(strings.ToLower(a.Vendor+" "+a.Model), strings.ToLower(b.Vendor+" "+b.Model))
	})
	for i, m := range models {
		byID[m.Id] = i
	}
}

// attachImages links each photo to its model; a photo of no model, or without a source, is a packaging mistake.
func attachImages() error {
	raw, err := images.ReadFile("images/SOURCES.json")
	if err != nil {
		return fmt.Errorf("read image sources: %w", err)
	}
	var sources map[string]struct {
		Source    string `json:"source"`
		SimilarTo string `json:"similarTo"`
	}
	if err := json.Unmarshal(raw, &sources); err != nil {
		return fmt.Errorf("parse image sources: %w", err)
	}
	entries, err := fs.ReadDir(images, "images")
	if err != nil {
		return fmt.Errorf("list images: %w", err)
	}
	for _, e := range entries {
		name := e.Name()
		if name == "SOURCES.json" {
			continue
		}
		p := imageRe.FindStringSubmatch(name)
		if p == nil {
			return fmt.Errorf("image %q: name must be <catalog id>.front.jpg or .rear.jpg", name)
		}
		i, ok := byID[p[1]]
		if !ok {
			return fmt.Errorf("image %q: no catalog model %q", name, p[1])
		}
		src := sources[name]
		if src.Source == "" {
			return fmt.Errorf("image %q: missing from SOURCES.json", name)
		}
		if p[2] == "front" {
			models[i].Images.Front = name
		} else {
			models[i].Images.Rear = name
		}
		models[i].Images.Source = src.Source
		models[i].Images.SimilarTo = src.SimilarTo
	}
	for name := range sources {
		if _, err := fs.Stat(images, "images/"+name); err != nil {
			return fmt.Errorf("SOURCES.json lists %q, which is not shipped", name)
		}
	}
	return nil
}
