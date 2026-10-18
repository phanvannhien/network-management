// Package notify sends the installation's e-mail and raises expiry alerts (P2-05, ADR-043).
package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// SMTPConfig is the outgoing mail server (the password already decrypted by the caller, never logged).
type SMTPConfig struct {
	Host        string
	Port        int
	Security    string // starttls | tls | none
	Username    string
	Password    string
	FromAddress string
	FromName    string
}

// Configured: a host and a sender are set.
func (c SMTPConfig) Configured() bool { return c.Host != "" && c.FromAddress != "" }

// Message is one e-mail: plain text, and HTML when given.
type Message struct {
	To      []string
	Subject string
	Text    string
	HTML    string
}

// Sender sends a message with a configuration (swapped in tests).
type Sender func(ctx context.Context, cfg SMTPConfig, msg Message) error

// ErrNotConfigured: no mail server is set up.
var ErrNotConfigured = errors.New("smtp not configured")

const sendTimeout = 30 * time.Second

// ValidAddress reports whether s is one plain e-mail address ("a@b.vn", no display name, no line breaks).
func ValidAddress(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && !strings.ContainsAny(s, "\r\n")
}

// Build renders the message as RFC 5322 bytes (headers encoded, text + HTML alternatives).
func Build(cfg SMTPConfig, msg Message, now time.Time) ([]byte, error) {
	for _, to := range msg.To {
		if !ValidAddress(to) {
			return nil, fmt.Errorf("bad recipient %q", to)
		}
	}
	if !ValidAddress(cfg.FromAddress) {
		return nil, fmt.Errorf("bad sender %q", cfg.FromAddress)
	}
	clean := func(s string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(s) }
	from := (&mail.Address{Name: clean(cfg.FromName), Address: cfg.FromAddress}).String()
	id := make([]byte, 12)
	if _, err := rand.Read(id); err != nil {
		return nil, fmt.Errorf("message id: %w", err)
	}
	var b bytes.Buffer
	h := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	h("From", from)
	h("To", strings.Join(msg.To, ", "))
	h("Subject", mime.QEncoding.Encode("utf-8", clean(msg.Subject)))
	h("Date", now.Format(time.RFC1123Z))
	domain := cfg.FromAddress[strings.LastIndex(cfg.FromAddress, "@")+1:]
	h("Message-ID", "<"+hex.EncodeToString(id)+"@"+domain+">")
	h("MIME-Version", "1.0")
	h("Auto-Submitted", "auto-generated")

	part := func(w *multipart.Writer, ctype, body string) error {
		pw, err := w.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {ctype + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return fmt.Errorf("mime part: %w", err)
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := qp.Write([]byte(body)); err != nil {
			return fmt.Errorf("mime body: %w", err)
		}
		return qp.Close()
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := part(w, "text/plain", msg.Text); err != nil {
		return nil, err
	}
	if msg.HTML != "" {
		if err := part(w, "text/html", msg.HTML); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("mime close: %w", err)
	}
	h("Content-Type", "multipart/alternative; boundary="+w.Boundary())
	b.WriteString("\r\n")
	b.Write(body.Bytes())
	return b.Bytes(), nil
}

// SendSMTP delivers a message through the configured server: implicit TLS (465), STARTTLS (587, required when
// chosen) or plain (internal relays only). Authentication only over an encrypted connection.
func SendSMTP(ctx context.Context, cfg SMTPConfig, msg Message) error {
	if !cfg.Configured() {
		return ErrNotConfigured
	}
	raw, err := Build(cfg, msg, time.Now())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	var conn net.Conn
	d := &net.Dialer{}
	if cfg.Security == "tls" {
		conn, err = (&tls.Dialer{NetDialer: d, Config: tlsCfg}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("connect %s: %w", addr, err)
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp greeting: %w", err)
	}
	defer func() { _ = c.Close() }()
	// Introduce ourselves with the sender's domain (some servers refuse "localhost").
	if err := c.Hello(cfg.FromAddress[strings.LastIndex(cfg.FromAddress, "@")+1:]); err != nil {
		return fmt.Errorf("smtp hello: %w", err)
	}
	encrypted := cfg.Security == "tls"
	if cfg.Security == "starttls" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("server does not offer STARTTLS")
		}
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
		encrypted = true
	}
	if cfg.Username != "" {
		if !encrypted {
			return errors.New("refusing to send the password over an unencrypted connection")
		}
		if err := c.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(cfg.FromAddress); err != nil {
		return fmt.Errorf("smtp from: %w", err)
	}
	// A recipient the server refuses does not stop the others (one stale address must not block every digest).
	var refused []string
	for _, to := range msg.To {
		if err := c.Rcpt(to); err != nil {
			refused = append(refused, fmt.Sprintf("%s (%v)", to, err))
		}
	}
	if len(refused) == len(msg.To) {
		return fmt.Errorf("smtp refused every recipient: %s", strings.Join(refused, "; "))
	}
	wc, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := wc.Write(raw); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("smtp end: %w", err)
	}
	// Accepted: a failing QUIT must not make the caller send it again.
	_ = c.Quit()
	return nil
}
