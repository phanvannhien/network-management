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
	"time"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
)

//go:embed data/*.json
var data embed.FS

// Photos (P2-12): images/<id>.front.jpg / <id>.rear.jpg, from the NetBox device type library (CC0); SOURCES.json
// gives the page each one comes from, and the sibling model it shows when the model itself has no photo.
//
//go:embed images
var images embed.FS

// Vendor milestones (P2-22): lifecycle.json, one entry per model with an official end-of-sale / end-of-support notice.
// Kept apart from the port data because notices come out on their own schedule.
//
//go:embed lifecycle.json
var lifecycleJSON []byte

var (
	once    sync.Once
	models  []apigen.CatalogModel
	byID    map[string]int
	byKey   map[string][]int // norm(model / part number / alias) → models, for Match
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
			m.Lifecycle = apigen.CatalogLifecycle{}
			byID[m.Id] = len(models)
			models = append(models, m)
		}
	}
	if loadErr = attachImages(); loadErr != nil {
		return
	}
	if loadErr = attachLifecycle(); loadErr != nil {
		return
	}
	slices.SortFunc(models, func(a, b apigen.CatalogModel) int {
		return strings.Compare(strings.ToLower(a.Vendor+" "+a.Model), strings.ToLower(b.Vendor+" "+b.Model))
	})
	byKey = map[string][]int{}
	for i, m := range models {
		byID[m.Id] = i
		seen := map[string]bool{}
		for _, x := range append(append([]string{m.Model}, m.PartNumbers...), m.Aliases...) {
			if k := norm(x); k != "" && !seen[k] {
				seen[k] = true
				byKey[k] = append(byKey[k], i)
			}
		}
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

// attachLifecycle sets each model's vendor milestones; a date that is not ISO, a sale after support or an entry for no
// model is a data mistake.
func attachLifecycle() error {
	var doc struct {
		Entries []struct {
			ID           string `json:"id"`
			EndOfSale    string `json:"endOfSale"`
			EndOfSupport string `json:"endOfSupport"`
			Source       string `json:"source"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(lifecycleJSON, &doc); err != nil {
		return fmt.Errorf("parse lifecycle.json: %w", err)
	}
	seen := map[string]bool{}
	for _, e := range doc.Entries {
		i, ok := byID[e.ID]
		switch {
		case !ok:
			return fmt.Errorf("lifecycle.json: no catalog model %q", e.ID)
		case seen[e.ID]:
			return fmt.Errorf("lifecycle.json: %q twice", e.ID)
		case e.EndOfSale == "" && e.EndOfSupport == "":
			return fmt.Errorf("lifecycle.json: %q has no date", e.ID)
		case !strings.HasPrefix(e.Source, "https://"):
			return fmt.Errorf("lifecycle.json: %q needs the vendor notice (https)", e.ID)
		}
		seen[e.ID] = true
		for _, d := range []string{e.EndOfSale, e.EndOfSupport} {
			if _, err := time.Parse(time.DateOnly, d); d != "" && err != nil {
				return fmt.Errorf("lifecycle.json: %q date %q is not YYYY-MM-DD", e.ID, d)
			}
		}
		if e.EndOfSale != "" && e.EndOfSupport != "" && e.EndOfSale > e.EndOfSupport {
			return fmt.Errorf("lifecycle.json: %q ends sale after support", e.ID)
		}
		models[i].Lifecycle = apigen.CatalogLifecycle{EndOfSale: e.EndOfSale, EndOfSupport: e.EndOfSupport, Source: e.Source}
	}
	return nil
}

// norm keeps ASCII letters and digits, lower case: "C1300-48P-4G" = "c1300 48p 4g". Model numbers are ASCII; the
// client's matcher also folds accents, which never occur in them.
func norm(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Names reports whether a device's model / part number still name catalog model c (an empty model keeps it).
func Names(c apigen.CatalogModel, model, partNumber string) bool {
	keys := []string{}
	for _, k := range []string{norm(model), norm(partNumber)} {
		if k != "" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return true
	}
	for _, x := range append(append([]string{c.Model}, c.PartNumbers...), c.Aliases...) {
		if slices.Contains(keys, norm(x)) {
			return true
		}
	}
	return false
}

// Match finds the model a device names by model or part number (exact after norm), preferring one of the device's
// type; the same rule as the client's matchCatalog.
func Match(model, partNumber, typ string) (apigen.CatalogModel, bool) {
	once.Do(load)
	var hits []int
	for _, k := range []string{norm(model), norm(partNumber)} {
		if k != "" {
			hits = append(hits, byKey[k]...)
		}
	}
	if len(hits) == 0 {
		return apigen.CatalogModel{}, false
	}
	slices.Sort(hits) // catalog order, like the client's filter
	for _, i := range hits {
		if string(models[i].Type) == typ {
			return models[i], true
		}
	}
	return models[hits[0]], true
}
