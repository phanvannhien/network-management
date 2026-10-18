package notify

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/secrets"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/store"
)

// Expiry alerts (P2-05, ADR-043): dates of devices in use reach a milestone (90 / 60 / 30 / 7 days before, then
// "passed") → one notification each, shown in the app; once a day the new ones go out in one digest e-mail.

// DigestHour: digests are sent from this local hour on (one per organization and day).
const DigestHour = 7

// PassedWindowDays: a date that passed longer ago than this is not announced (the dashboard lists it).
const PassedWindowDays = 30

// SMTPPasswordAAD binds the stored SMTP password ciphertext to its purpose.
var SMTPPasswordAAD = []byte("smtp_settings.password")

// Milestone is the milestone a date `days` away has reached: the smallest milestone ≥ days, 0 once it has passed;
// false while it is further than every milestone.
func Milestone(days int, milestones []int32) (int32, bool) {
	if days < 0 {
		return 0, true
	}
	best, ok := int32(0), false
	for _, m := range milestones {
		if int(m) >= days && (!ok || m < best) {
			best, ok = m, true
		}
	}
	return best, ok
}

// KindLabel names a kind in e-mails (Vietnamese, like the rest of the user-facing text).
func KindLabel(kind string) string {
	switch kind {
	case "warranty":
		return "Hết bảo hành"
	case "license":
		return "Hết license"
	case "eos":
		return "Hãng ngừng hỗ trợ"
	case "contract":
		return "Hợp đồng hết hạn"
	}
	return kind
}

// DigestItem is one line of a digest: a device date, or a contract end (ContractID set; Hostname = contract name,
// SiteCode = vendor).
type DigestItem struct {
	DeviceID   uuid.UUID
	ContractID uuid.UUID
	Hostname   string
	SiteCode   string
	Kind       string
	Due        time.Time
}

// Digest renders the e-mail of an organization's new notifications.
func Digest(orgName string, orgID uuid.UUID, publicURL string, today time.Time, items []DigestItem) Message {
	base := strings.TrimRight(publicURL, "/")
	passed := 0
	for _, it := range items {
		if it.Due.Before(today) {
			passed++
		}
	}
	subject := fmt.Sprintf("[NTB] %s: %d mốc hết hạn thiết bị", orgName, len(items))
	if passed > 0 {
		subject += fmt.Sprintf(" (%d đã quá hạn)", passed)
	}
	left := func(due time.Time) string {
		days := int(due.Sub(today).Hours() / 24)
		switch {
		case days < 0:
			return fmt.Sprintf("đã quá %d ngày", -days)
		case days == 0:
			return "hôm nay"
		}
		return fmt.Sprintf("còn %d ngày", days)
	}
	var text, rows strings.Builder
	fmt.Fprintf(&text, "Tổ chức %s có %d mốc hết hạn mới:\n\n", orgName, len(items))
	for _, it := range items {
		link := ""
		switch {
		case base == "":
		case it.ContractID != uuid.Nil:
			link = fmt.Sprintf("%s/o/%s/contracts/%s", base, orgID, it.ContractID)
		default:
			link = fmt.Sprintf("%s/o/%s/devices/%s", base, orgID, it.DeviceID)
		}
		fmt.Fprintf(&text, "- %s (%s) — %s: %s (%s)", it.Hostname, it.SiteCode, KindLabel(it.Kind), it.Due.Format("02/01/2006"), left(it.Due))
		if link != "" {
			fmt.Fprintf(&text, "\n  %s", link)
		}
		text.WriteString("\n")
		name := html.EscapeString(it.Hostname)
		if link != "" {
			name = fmt.Sprintf(`<a href="%s">%s</a>`, html.EscapeString(link), name)
		}
		color := ""
		if it.Due.Before(today) {
			color = ` style="color:#b91c1c"`
		}
		fmt.Fprintf(&rows, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td%s>%s</td></tr>",
			name, html.EscapeString(it.SiteCode), html.EscapeString(KindLabel(it.Kind)), it.Due.Format("02/01/2006"), color, html.EscapeString(left(it.Due)))
	}
	footer := "Email tự động từ Network Topology Builder. Mỗi mốc chỉ báo một lần."
	settings := ""
	if base != "" {
		settings = fmt.Sprintf("%s/o/%s/alerts", base, orgID)
		fmt.Fprintf(&text, "\nĐổi người nhận / mốc báo: %s\n", settings)
	}
	fmt.Fprintf(&text, "\n%s\n", footer)
	var h strings.Builder
	fmt.Fprintf(&h, `<p>Tổ chức <b>%s</b> có %d mốc hết hạn mới:</p>`, html.EscapeString(orgName), len(items))
	h.WriteString(`<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">`)
	h.WriteString(`<tr style="text-align:left"><th>Thiết bị / hợp đồng</th><th>Site / nhà cung cấp</th><th>Loại</th><th>Ngày</th><th></th></tr>`)
	h.WriteString(rows.String())
	h.WriteString(`</table>`)
	if settings != "" {
		fmt.Fprintf(&h, `<p><a href="%s">Đổi người nhận / mốc báo</a></p>`, html.EscapeString(settings))
	}
	fmt.Fprintf(&h, `<p style="color:#666;font-size:12px">%s</p>`, footer)
	return Message{Subject: subject, Text: text.String(), HTML: h.String()}
}

// LoadSMTP reads the mail server settings and decrypts the password. No row = not configured.
func LoadSMTP(ctx context.Context, q store.Querier, keys *secrets.Keyring) (SMTPConfig, string, error) {
	row, err := q.GetSmtpSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return SMTPConfig{}, "", nil
	}
	if err != nil {
		return SMTPConfig{}, "", fmt.Errorf("load smtp settings: %w", err)
	}
	cfg := SMTPConfig{Host: row.Host, Port: int(row.Port), Security: row.Security, Username: row.Username,
		FromAddress: row.FromAddress, FromName: row.FromName}
	if row.PasswordCiphertext != nil {
		pw, err := keys.Open(secrets.Sealed{Ciphertext: row.PasswordCiphertext, WrappedDEK: row.PasswordWrappedDek,
			KeyVersion: row.PasswordKeyVersion.Int16}, SMTPPasswordAAD)
		if err != nil {
			return SMTPConfig{}, "", fmt.Errorf("decrypt smtp password: %w", err)
		}
		cfg.Password = string(pw)
	}
	return cfg, row.PublicUrl, nil
}

// Runner raises notifications and sends digests.
type Runner struct {
	Pool   *pgxpool.Pool
	Keys   *secrets.Keyring
	Send   Sender
	Logger *slog.Logger
}

// advisoryKey keeps two API processes from running the alerts at once.
const advisoryKey = 0x4e544205 // "NTB" P2-05

// RunOnce does one pass at `now` (local time of the server).
func (r Runner) RunOnce(ctx context.Context, now time.Time) error {
	conn, err := r.Pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire: %w", err)
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", advisoryKey).Scan(&locked); err != nil {
		return fmt.Errorf("alert lock: %w", err)
	}
	if !locked {
		return nil
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", advisoryKey) }()

	q := store.New(conn)
	now = now.In(time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	orgs, err := q.AlertOrganizations(ctx)
	if err != nil {
		return fmt.Errorf("alert organizations: %w", err)
	}
	var smtpCfg SMTPConfig
	var publicURL string
	smtpLoaded, smtpBroken := false, false
	for _, o := range orgs {
		if !o.Enabled || len(o.Kinds) == 0 || len(o.Milestones) == 0 {
			continue
		}
		if err := raise(ctx, q, o, today); err != nil {
			r.Logger.Warn("alerts: raising failed", "organization", uuid.UUID(o.ID.Bytes), "error", err)
			continue
		}
		if now.Hour() < DigestHour || (o.LastDigestOn.Valid && !o.LastDigestOn.Time.Before(today)) {
			continue
		}
		if !smtpLoaded {
			if smtpCfg, publicURL, err = LoadSMTP(ctx, q, r.Keys); err != nil {
				// Not "no mail server": leave the notifications for the next run instead of marking them handled.
				r.Logger.Warn("alerts: smtp settings unusable", "error", err)
				smtpBroken = true
			}
			smtpLoaded = true
		}
		if smtpBroken {
			continue
		}
		if err := r.digest(ctx, q, o, today, smtpCfg, publicURL); err != nil {
			r.Logger.Warn("alerts: digest not sent", "organization", uuid.UUID(o.ID.Bytes), "error", err)
		}
	}
	return nil
}

// raise records the milestones the organization's dates have reached (each once).
func raise(ctx context.Context, q *store.Queries, o store.AlertOrganizationsRow, today time.Time) error {
	horizon := int32(0)
	for _, m := range o.Milestones {
		horizon = max(horizon, m)
	}
	// Dates long past (an old inventory imported at once) are on the dashboard; announcing years of them would flood
	// the first digest.
	cands, err := q.AlertCandidates(ctx, store.AlertCandidatesParams{OrganizationID: o.ID,
		Since: pgtype.Date{Time: today.AddDate(0, 0, -PassedWindowDays), Valid: true},
		Until: pgtype.Date{Time: today.AddDate(0, 0, int(horizon)), Valid: true}})
	if err != nil {
		return fmt.Errorf("alert candidates: %w", err)
	}
	if slices.Contains(o.Kinds, "contract") {
		ends, err := q.AlertContractCandidates(ctx, store.AlertContractCandidatesParams{OrganizationID: o.ID,
			Since: pgtype.Date{Time: today.AddDate(0, 0, -PassedWindowDays), Valid: true},
			Until: pgtype.Date{Time: today.AddDate(0, 0, int(horizon)), Valid: true}})
		if err != nil {
			return fmt.Errorf("contract candidates: %w", err)
		}
		for _, c := range ends {
			m, ok := Milestone(int(c.Day.Time.Sub(today).Hours()/24), o.Milestones)
			if !ok {
				continue
			}
			if _, err := q.InsertContractNotification(ctx, store.InsertContractNotificationParams{OrganizationID: o.ID,
				ContractID: c.ContractID, DueDate: c.Day, Milestone: m}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("insert contract notification: %w", err)
			}
		}
	}
	for _, c := range cands {
		if !slices.Contains(o.Kinds, c.Kind) {
			continue
		}
		m, ok := Milestone(int(c.Day.Time.Sub(today).Hours()/24), o.Milestones)
		if !ok {
			continue
		}
		if _, err := q.InsertNotification(ctx, store.InsertNotificationParams{OrganizationID: o.ID, Kind: c.Kind,
			DeviceID: c.DeviceID, DueDate: c.Day, Milestone: m}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("insert notification: %w", err)
		}
	}
	return nil
}

// digest e-mails the organization's new notifications. Without a mail server or recipients they stay in the app
// only (marked handled, so turning e-mail on later does not send a backlog).
func (r Runner) digest(ctx context.Context, q *store.Queries, o store.AlertOrganizationsRow, today time.Time, cfg SMTPConfig, publicURL string) error {
	rows, err := q.UnsentNotifications(ctx, o.ID)
	if err != nil {
		return fmt.Errorf("unsent notifications: %w", err)
	}
	if len(rows) == 0 {
		return nil
	}
	ids := make([]pgtype.UUID, 0, len(rows))
	var items []DigestItem
	for _, n := range rows {
		ids = append(ids, n.ID)
		if n.Current && slices.Contains(o.Kinds, n.Kind) {
			items = append(items, DigestItem{DeviceID: uuid.UUID(n.DeviceID.Bytes), ContractID: uuid.UUID(n.ContractID.Bytes),
				Hostname: n.Title, SiteCode: n.Place, Kind: n.Kind, Due: n.DueDate.Time})
		}
	}
	to, err := Recipients(ctx, q, o)
	if err != nil {
		return err
	}
	if len(items) > 0 && len(to) > 0 && cfg.Configured() {
		msg := Digest(o.Name, uuid.UUID(o.ID.Bytes), publicURL, today, items)
		msg.To = to
		if err := r.Send(ctx, cfg, msg); err != nil {
			return err // kept for the next run
		}
	}
	if err := q.MarkNotificationsEmailed(ctx, store.MarkNotificationsEmailedParams{OrganizationID: o.ID, Ids: ids}); err != nil {
		return fmt.Errorf("mark emailed: %w", err)
	}
	if err := q.SetAlertDigestDay(ctx, store.SetAlertDigestDayParams{OrganizationID: o.ID, Day: pgtype.Date{Time: today, Valid: true}}); err != nil {
		return fmt.Errorf("digest day: %w", err)
	}
	return nil
}

// Recipients: owners and admins (when chosen) and the extra addresses, each once.
func Recipients(ctx context.Context, q store.Querier, o store.AlertOrganizationsRow) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	add := func(e string) {
		k := strings.ToLower(strings.TrimSpace(e))
		if k != "" && !seen[k] && ValidAddress(strings.TrimSpace(e)) {
			seen[k] = true
			out = append(out, strings.TrimSpace(e))
		}
	}
	if o.EmailAdmins {
		admins, err := q.AlertAdminEmails(ctx, o.ID)
		if err != nil {
			return nil, fmt.Errorf("alert admins: %w", err)
		}
		for _, a := range admins {
			add(a)
		}
	}
	for _, e := range o.ExtraEmails {
		add(e)
	}
	return out, nil
}

// Loop runs the alerts shortly after start, then every hour, until ctx ends.
func (r Runner) Loop(ctx context.Context) {
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := r.RunOnce(ctx, time.Now()); err != nil {
				r.Logger.Warn("alerts run failed", "error", err)
			}
			timer.Reset(time.Hour)
		}
	}
}
