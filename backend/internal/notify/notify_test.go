package notify

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMilestone(t *testing.T) {
	ms := []int32{90, 60, 30, 7}
	for _, c := range []struct {
		days int
		want int32
		ok   bool
	}{
		{120, 0, false}, {90, 90, true}, {61, 90, true}, {45, 60, true}, {30, 30, true}, {8, 30, true},
		{7, 7, true}, {0, 7, true}, {-1, 0, true}, {-400, 0, true},
	} {
		got, ok := Milestone(c.days, ms)
		if got != c.want || ok != c.ok {
			t.Errorf("Milestone(%d) = %d %v, want %d %v", c.days, got, ok, c.want, c.ok)
		}
	}
}

func TestBuildRefusesHeaderInjection(t *testing.T) {
	cfg := SMTPConfig{Host: "smtp.example.com", Port: 587, FromAddress: "ntb@example.com", FromName: "NTB\r\nBcc: evil@x.com"}
	raw, err := Build(cfg, Message{To: []string{"ops@example.com"}, Subject: "Hết hạn\r\nBcc: evil@x.com", Text: "x"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	head := string(raw[:strings.Index(string(raw), "\r\n\r\n")])
	if strings.Contains(strings.ToLower(head), "\r\nbcc:") {
		t.Fatalf("injected header:\n%s", head)
	}
	if !strings.Contains(head, "Subject: =?utf-8?") {
		t.Errorf("subject not encoded:\n%s", head)
	}
	for _, bad := range []string{"a@b.c\r\nBcc: x@y.z", "Name <a@b.c>", "not-an-address"} {
		if _, err := Build(cfg, Message{To: []string{bad}, Text: "x"}, time.Now()); err == nil {
			t.Errorf("recipient %q accepted", bad)
		}
	}
}

func TestDigest(t *testing.T) {
	today := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	org, dev := uuid.New(), uuid.New()
	m := Digest("Khách <A>", org, "https://ntb.example.com/", today, []DigestItem{
		{DeviceID: dev, Hostname: "FW<01>", SiteCode: "HCM01", Kind: "warranty", Due: today.AddDate(0, 0, 30)},
		{DeviceID: dev, Hostname: "FW<01>", SiteCode: "HCM01", Kind: "eos", Due: today.AddDate(0, 0, -3)},
	})
	if !strings.Contains(m.Subject, "2 mốc") || !strings.Contains(m.Subject, "1 đã quá hạn") {
		t.Errorf("subject: %s", m.Subject)
	}
	link := "https://ntb.example.com/o/" + org.String() + "/devices/" + dev.String()
	if !strings.Contains(m.Text, link) || !strings.Contains(m.Text, "còn 30 ngày") || !strings.Contains(m.Text, "đã quá 3 ngày") {
		t.Errorf("text:\n%s", m.Text)
	}
	if strings.Contains(m.HTML, "FW<01>") || strings.Contains(m.HTML, "<A>") || !strings.Contains(m.HTML, "FW&lt;01&gt;") {
		t.Errorf("html not escaped:\n%s", m.HTML)
	}
	if noURL := Digest("A", org, "", today, nil); strings.Contains(noURL.Text, "http") {
		t.Errorf("links without a public URL: %s", noURL.Text)
	}
}
