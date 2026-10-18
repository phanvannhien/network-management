package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/backup"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// backupStaleAfter: no good backup for this long shows red on the system page.
const backupStaleAfter = 48 * time.Hour

func toBackupRun(r store.BackupRun) apigen.BackupRun {
	out := apigen.BackupRun{
		Id: uuid.UUID(r.ID.Bytes), Kind: apigen.BackupRunKind(r.Kind), Status: apigen.BackupRunStatus(r.Status),
		StartedAt: r.StartedAt.Time, FileName: r.FileName, SizeBytes: r.SizeBytes, Error: r.Error,
		Verified: r.VerifiedAt.Valid && r.VerifyError == "",
	}
	if r.FinishedAt.Valid {
		out.FinishedAt = &r.FinishedAt.Time
	}
	return out
}

// AdminGetBackups shows system admins how backups are set up and how the recent ones went (P2-13). Paths and
// passphrases never leave the server beyond the directory name.
func (s *Server) AdminGetBackups(ctx context.Context, _ apigen.AdminGetBackupsRequestObject) (apigen.AdminGetBackupsResponseObject, error) {
	out := apigen.BackupStatus{
		Enabled: s.backups.Enabled, Dir: s.backups.Dir, Schedule: s.backups.Schedule, Keep: s.backups.Keep,
		Runs: []apigen.BackupRun{},
	}
	runs, err := s.q.ListBackupRuns(ctx, 20)
	if err != nil {
		return nil, fmt.Errorf("backup runs: %w", err)
	}
	for _, r := range runs {
		out.Runs = append(out.Runs, toBackupRun(r))
	}
	last, ok, err := backup.LastGood(ctx, s.q)
	if err != nil {
		return nil, err
	}
	if ok {
		v := toBackupRun(last)
		out.LastGood = &v
	}
	out.Stale = backup.Stale(last.StartedAt, ok, backupStaleAfter, time.Now())
	return apigen.AdminGetBackups200JSONResponse(out), nil
}
