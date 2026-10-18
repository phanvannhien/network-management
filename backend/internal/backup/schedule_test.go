package backup

import (
	"testing"
	"time"
)

func TestDue(t *testing.T) {
	loc := time.FixedZone("ICT", 7*3600)
	at := func(d, h, m int) *time.Time { v := time.Date(2026, 10, d, h, m, 0, 0, loc); return &v }
	now := *at(18, 2, 5)
	cases := []struct {
		name              string
		now               time.Time
		lastGood, attempt *time.Time
		failed            bool
		want              bool
	}{
		{"before the time", *at(18, 1, 59), at(17, 2, 0), at(17, 2, 0), false, false},
		{"past the time, yesterday's done", now, at(17, 2, 1), at(17, 2, 1), false, true},
		{"already done today", now, at(18, 2, 1), at(18, 2, 1), false, false},
		{"never done", now, nil, nil, false, true},
		{"failed 10 minutes ago", *at(18, 2, 15), at(17, 2, 1), at(18, 2, 5), true, false},
		{"failed over an hour ago", *at(18, 3, 30), at(17, 2, 1), at(18, 2, 5), true, true},
		{"server was off at 02:00", *at(18, 9, 0), at(16, 2, 1), at(16, 2, 1), false, true},
	}
	for _, c := range cases {
		if got := Due(c.now, 2, 0, c.lastGood, c.attempt, c.failed); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
	if _, _, ok, err := ParseClock("off"); ok || err != nil {
		t.Error("off")
	}
	if h, m, ok, err := ParseClock("23:30"); !ok || err != nil || h != 23 || m != 30 {
		t.Error("23:30")
	}
	if _, _, _, err := ParseClock("25:00"); err == nil {
		t.Error("25:00 accepted")
	}
}
