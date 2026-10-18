package notify

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
)

// fakeSMTP is a minimal plain SMTP server: it accepts one message and records the dialogue.
func fakeSMTP(t *testing.T) (port int, got chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	got = make(chan string, 1)
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = c.Close() }()
		r := bufio.NewReader(c)
		var log strings.Builder
		say := func(s string) { _, _ = c.Write([]byte(s + "\r\n")) }
		say("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				got <- log.String()
				return
			}
			log.WriteString(line)
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"):
				say("250 fake")
			case strings.HasPrefix(cmd, "DATA"):
				say("354 go")
				for {
					l, err := r.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
					log.WriteString(l)
				}
				say("250 queued")
			case strings.HasPrefix(cmd, "RCPT") && strings.Contains(cmd, "GONE"):
				say("550 no such user")
			case strings.HasPrefix(cmd, "QUIT"):
				say("221 bye")
				got <- log.String()
				return
			default:
				say("250 ok")
			}
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, got
}

func TestSendSMTPPlainRelay(t *testing.T) {
	port, got := fakeSMTP(t)
	cfg := SMTPConfig{Host: "127.0.0.1", Port: port, Security: "none", FromAddress: "ntb@example.com", FromName: "NTB"}
	if err := SendSMTP(context.Background(), cfg, Message{To: []string{"ops@example.com"}, Subject: "Thử", Text: "Xin chào"}); err != nil {
		t.Fatal(err)
	}
	log := <-got
	for _, want := range []string{"MAIL FROM:<ntb@example.com>", "RCPT TO:<ops@example.com>", "Content-Type: multipart/alternative"} {
		if !strings.Contains(log, want) {
			t.Errorf("missing %q in:\n%s", want, log)
		}
	}
}

func TestSendSMTPRefusesPasswordInClear(t *testing.T) {
	port, _ := fakeSMTP(t)
	cfg := SMTPConfig{Host: "127.0.0.1", Port: port, Security: "none", Username: "u", Password: "p", FromAddress: "ntb@example.com"}
	err := SendSMTP(context.Background(), cfg, Message{To: []string{"ops@example.com"}, Text: "x"})
	if err == nil || !strings.Contains(err.Error(), "unencrypted") {
		t.Fatalf("err = %v", err)
	}
	// STARTTLS chosen but not offered: refused, not downgraded.
	port2, _ := fakeSMTP(t)
	cfg = SMTPConfig{Host: "127.0.0.1", Port: port2, Security: "starttls", FromAddress: "ntb@example.com"}
	if err := SendSMTP(context.Background(), cfg, Message{To: []string{"ops@example.com"}, Text: "x"}); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("starttls err = %v", err)
	}
}

func TestSendSMTPSkipsRefusedRecipient(t *testing.T) {
	port, got := fakeSMTP(t)
	cfg := SMTPConfig{Host: "127.0.0.1", Port: port, Security: "none", FromAddress: "ntb@example.com"}
	if err := SendSMTP(context.Background(), cfg, Message{To: []string{"gone@example.com", "ops@example.com"}, Text: "x"}); err != nil {
		t.Fatalf("one refused recipient failed the message: %v", err)
	}
	if log := <-got; !strings.Contains(log, "RCPT TO:<ops@example.com>") || !strings.Contains(log, "Content-Type") {
		t.Errorf("not delivered to the others:\n%s", log)
	}
	port2, _ := fakeSMTP(t)
	cfg.Port = port2
	if err := SendSMTP(context.Background(), cfg, Message{To: []string{"gone@example.com"}, Text: "x"}); err == nil {
		t.Error("every recipient refused, yet no error")
	}
}
