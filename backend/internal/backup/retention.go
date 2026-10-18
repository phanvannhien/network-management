package backup

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Policy is a grandfather-father-son retention: the newest backup of each of the last Daily days, Weekly ISO weeks
// and Monthly months that have one (counted on the installation's calendar). The newest backup is always kept.
type Policy struct {
	Daily, Weekly, Monthly int
}

// DefaultPolicy keeps 7 days, 4 weeks and 12 months.
var DefaultPolicy = Policy{Daily: 7, Weekly: 4, Monthly: 12}

// ParsePolicy reads "7,4,12" (daily, weekly, monthly).
func ParsePolicy(s string) (Policy, error) {
	if strings.TrimSpace(s) == "" {
		return DefaultPolicy, nil
	}
	parts := strings.Split(s, ",")
	if len(parts) != 3 {
		return Policy{}, fmt.Errorf("NTB_BACKUP_KEEP: want daily,weekly,monthly (e.g. 7,4,12), got %q", s)
	}
	var n [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil || v < 0 || v > 1000 {
			return Policy{}, fmt.Errorf("NTB_BACKUP_KEEP: %q is not a count from 0 to 1000", p)
		}
		n[i] = v
	}
	return Policy{Daily: n[0], Weekly: n[1], Monthly: n[2]}, nil
}

// File is one backup in the backup directory.
type File struct {
	Name string
	At   time.Time
	Kind string
}

// keepOther is how many manual / pre-upgrade backups stay (they are not part of the daily rotation).
const keepOther = 5

// Prune splits files into those the policy keeps and those to delete: scheduled backups follow the policy; manual
// and pre-upgrade ones keep the newest keepOther.
func Prune(files []File, p Policy) (keep, drop []File) {
	var scheduled, other []File
	for _, f := range files {
		if f.Kind == "scheduled" {
			scheduled = append(scheduled, f)
		} else {
			other = append(other, f)
		}
	}
	keep, drop = gfs(scheduled, p)
	slices.SortFunc(other, func(a, b File) int { return b.At.Compare(a.At) })
	for i, f := range other {
		if i < keepOther {
			keep = append(keep, f)
		} else {
			drop = append(drop, f)
		}
	}
	slices.SortFunc(keep, func(a, b File) int { return b.At.Compare(a.At) })
	return keep, drop
}

func gfs(files []File, p Policy) (keep, drop []File) {
	list := slices.Clone(files)
	slices.SortFunc(list, func(a, b File) int { return b.At.Compare(a.At) }) // newest first
	kept := map[string]bool{}
	pick := func(n int, bucket func(time.Time) string) {
		seen := map[string]bool{}
		for _, f := range list {
			if len(seen) >= n {
				return
			}
			b := bucket(f.At.Local())
			if !seen[b] {
				seen[b] = true
				kept[f.Name] = true
			}
		}
	}
	pick(p.Daily, func(t time.Time) string { return t.Format("2006-01-02") })
	pick(p.Weekly, func(t time.Time) string { y, w := t.ISOWeek(); return fmt.Sprintf("%d-W%02d", y, w) })
	pick(p.Monthly, func(t time.Time) string { return t.Format("2006-01") })
	if len(list) > 0 {
		kept[list[0].Name] = true
	}
	for _, f := range list {
		if kept[f.Name] {
			keep = append(keep, f)
		} else {
			drop = append(drop, f)
		}
	}
	return keep, drop
}

const fileSuffix = ".ntbbak"

// FileName names a backup: ntb-20261018T190000Z-scheduled.ntbbak (UTC, sorts by time).
func FileName(at time.Time, kind string) string {
	return "ntb-" + at.UTC().Format("20060102T150405Z") + "-" + kind + fileSuffix
}

// ParseFileName reads the time of a backup from its name (false: not a backup file).
func ParseFileName(name string) (File, bool) {
	if !strings.HasPrefix(name, "ntb-") || !strings.HasSuffix(name, fileSuffix) || len(name) < len("ntb-20060102T150405Z-x"+fileSuffix) || name[20] != '-' {
		return File{}, false
	}
	at, err := time.Parse("20060102T150405Z", name[4:20])
	if err != nil {
		return File{}, false
	}
	return File{Name: name, At: at, Kind: strings.TrimSuffix(name[21:], fileSuffix)}, true
}
