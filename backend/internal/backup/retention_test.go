package backup

import (
	"testing"
	"time"
)

func TestPrune(t *testing.T) {
	time.Local = time.UTC
	start := time.Date(2026, 1, 1, 2, 0, 0, 0, time.UTC)
	var files []File
	// One backup a night for 400 days, plus a manual one on the last day.
	for d := 0; d < 400; d++ {
		at := start.AddDate(0, 0, d)
		files = append(files, File{Name: FileName(at, "scheduled"), At: at, Kind: "scheduled"})
	}
	last := start.AddDate(0, 0, 399).Add(10 * time.Hour)
	files = append(files, File{Name: FileName(last, "manual"), At: last, Kind: "manual"})
	// Manual backups stay out of the rotation: the newest 5 are kept.
	for i := range 8 {
		at := start.AddDate(0, 0, 10*i).Add(time.Hour)
		files = append(files, File{Name: FileName(at, "manual"), At: at, Kind: "manual"})
	}
	keep, drop := Prune(files, DefaultPolicy)
	if len(keep)+len(drop) != len(files) {
		t.Fatalf("lost files: %d + %d", len(keep), len(drop))
	}
	if keep[0].At != last {
		t.Errorf("newest not kept: %v", keep[0])
	}
	// 7 days (the manual one is the newest of its day) + up to 4 weeks + up to 12 months, overlapping.
	manual := 0
	for _, f := range keep {
		if f.Kind == "manual" {
			manual++
		}
	}
	if manual != 5 {
		t.Errorf("manual kept: %d", manual)
	}
	if len(keep)-manual < 12 || len(keep)-manual > 7+4+12 {
		t.Errorf("kept %d", len(keep))
	}
	for _, f := range keep {
		if f.Kind == "scheduled" && f.At.Before(last.AddDate(-1, 0, 0)) {
			t.Errorf("kept a scheduled backup older than a year: %v", f.At)
		}
	}
	// Nothing to delete when there are only a few.
	if _, d := Prune(files[:3], DefaultPolicy); len(d) != 0 {
		t.Errorf("dropped from 3 files: %v", d)
	}
	// Keep nothing but the newest.
	if k, _ := Prune(files[:400], Policy{}); len(k) != 1 {
		t.Errorf("policy 0,0,0 kept %d", len(k))
	}
}

func TestFileNames(t *testing.T) {
	at := time.Date(2026, 10, 18, 19, 0, 5, 0, time.UTC)
	name := FileName(at, "pre-upgrade")
	if name != "ntb-20261018T190005Z-pre-upgrade.ntbbak" {
		t.Fatal(name)
	}
	if f, ok := ParseFileName(name); !ok || !f.At.Equal(at) || f.Kind != "pre-upgrade" {
		t.Fatalf("parse: %v %v", f, ok)
	}
	for _, bad := range []string{"notes.txt", "ntb-.ntbbak", ".ntb-20261018T190005Z-x.ntbbak.partial", "ntb-20261018T190005Z-../x.ntbbak", "ntb-20261018T190005Z-a/b.ntbbak", "ntb-20261018T190005Z-A.ntbbak"} {
		if _, ok := ParseFileName(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
	if p, err := ParsePolicy("14, 8, 24"); err != nil || p != (Policy{14, 8, 24}) {
		t.Errorf("policy: %v %v", p, err)
	}
	if _, err := ParsePolicy("7,4"); err == nil {
		t.Error("bad policy accepted")
	}
}
