package backup

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// ParseClock reads "HH:MM" (the daily backup time); "off" disables the schedule (ok false).
func ParseClock(s string) (h, m int, ok bool, err error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "off" || s == "" {
		return 0, 0, false, nil
	}
	hh, mm, found := strings.Cut(s, ":")
	h, err1 := strconv.Atoi(hh)
	m, err2 := strconv.Atoi(mm)
	if !found || err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false, fmt.Errorf("NTB_BACKUP_TIME: want HH:MM or off, got %q", s)
	}
	return h, m, true, nil
}

// Due tells whether the daily backup should run now: past today's time (local calendar), no good scheduled backup
// since then, and no failed attempt in the last hour (retried hourly, not in a loop). A server switched off at the
// time catches up when it comes back.
func Due(now time.Time, h, m int, lastGood, lastAttempt *time.Time, lastFailed bool) bool {
	at := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
	if now.Before(at) {
		return false
	}
	if lastGood != nil && !lastGood.Before(at) {
		return false
	}
	if lastFailed && lastAttempt != nil && now.Sub(*lastAttempt) < time.Hour {
		return false
	}
	return true
}

// Scheduler runs the daily backup inside the API process.
type Scheduler struct {
	Svc    *Service
	Hour   int
	Minute int
	Logger *slog.Logger
}

// Loop checks every 5 minutes until ctx ends.
func (sc Scheduler) Loop(ctx context.Context) {
	sc.Svc.CleanPartials()
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		sc.tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (sc Scheduler) tick(ctx context.Context) {
	q := store.New(sc.Svc.Pool)
	var lastGood, lastAttempt *time.Time
	failed := false
	if r, err := q.LastGoodBackupOfKind(ctx, "scheduled"); err == nil {
		lastGood = &r.StartedAt.Time
	} else if !errors.Is(err, pgx.ErrNoRows) {
		sc.Logger.Warn("backup schedule", "error", err)
		return
	}
	if r, err := q.LastBackupOfKind(ctx, "scheduled"); err == nil {
		lastAttempt, failed = &r.StartedAt.Time, r.Status == "failed"
	}
	if !Due(time.Now(), sc.Hour, sc.Minute, lastGood, lastAttempt, failed) {
		return
	}
	res, err := sc.Svc.Run(ctx, "scheduled")
	if err != nil {
		if !errors.Is(err, ErrBusy) {
			sc.Logger.Error("scheduled backup failed", "error", err)
		}
		return
	}
	sc.Logger.Info("scheduled backup done", "file", res.File, "bytes", res.Size, "pruned", res.Pruned, "took", res.Duration.String())
}
