package backup

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Destinations (P2-13 step 2, ADR-053): every good backup is copied with rclone to the enabled destinations — a
// mounted folder (NAS share, USB disk), SFTP, S3-compatible storage (AWS, Backblaze B2, Wasabi, Cloudflare R2,
// Synology C2, MinIO), Google Drive, OneDrive or Dropbox. The files are the encrypted .ntbbak; rclone gets a
// throw-away config (0600, deleted after) holding the destination's secrets.

// Target kinds.
const (
	KindLocal    = "local"
	KindSFTP     = "sftp"
	KindS3       = "s3"
	KindDrive    = "drive"
	KindOneDrive = "onedrive"
	KindDropbox  = "dropbox"
)

// TargetSettings are a destination's non-secret settings (stored as JSON).
type TargetSettings struct {
	// Path is the folder on the destination (a prefix inside the bucket for S3).
	Path string `json:"path,omitempty"`
	// SFTP.
	Host string `json:"host,omitempty"`
	Port int    `json:"port,omitempty"`
	User string `json:"user,omitempty"`
	// HostKey: the server's known_hosts lines (ssh-keyscan output): the server is checked, not trusted blindly.
	HostKey string `json:"hostKey,omitempty"`
	// S3.
	Provider    string `json:"provider,omitempty"`
	Endpoint    string `json:"endpoint,omitempty"`
	Region      string `json:"region,omitempty"`
	Bucket      string `json:"bucket,omitempty"`
	AccessKeyID string `json:"accessKeyId,omitempty"`
	// OneDrive (found from the token when saved).
	DriveID   string `json:"driveId,omitempty"`
	DriveType string `json:"driveType,omitempty"`
}

// TargetSecret are a destination's secrets (sealed with the master key as one JSON).
type TargetSecret struct {
	Password   string `json:"password,omitempty"`   // SFTP
	PrivateKey string `json:"privateKey,omitempty"` // SFTP, PEM
	SecretKey  string `json:"secretKey,omitempty"`  // S3 secret access key
	Token      string `json:"token,omitempty"`      // Google Drive / OneDrive / Dropbox: rclone authorize output
}

// Target is one destination.
type Target struct {
	ID       string
	Name     string
	Kind     string
	Settings TargetSettings
	Secret   TargetSecret
	Keep     Policy
}

// S3Providers are the rclone S3 providers offered ("Other" = any S3-compatible endpoint, e.g. Backblaze B2).
var S3Providers = []string{"AWS", "Cloudflare", "Wasabi", "Synology", "Minio", "Other"}

// MessageError is a message for the admin, shown as is (Vietnamese, a full sentence).
type MessageError string

func (e MessageError) Error() string { return string(e) }

// Validate checks a destination before it is saved; messages are shown to the admin.
func (t Target) Validate() error {
	st := t.Settings
	need := func(v, what string) error {
		if strings.TrimSpace(v) == "" {
			return MessageError("Thiếu " + what)
		}
		return nil
	}
	if strings.ContainsAny(st.Path, "\r\n") || strings.Contains(st.Path, "..") {
		return MessageError("Đường dẫn không hợp lệ")
	}
	switch t.Kind {
	case KindLocal:
		if !strings.HasPrefix(st.Path, "/") {
			return MessageError("Thư mục phải là đường dẫn tuyệt đối trong container (vd /mnt/nas/ntb)")
		}
	case KindSFTP:
		if err := need(st.Host, "máy chủ SFTP"); err != nil {
			return err
		}
		if err := need(st.User, "tên đăng nhập SFTP"); err != nil {
			return err
		}
		if st.Port < 0 || st.Port > 65535 {
			return MessageError("Cổng SFTP không hợp lệ")
		}
		if t.Secret.Password == "" && t.Secret.PrivateKey == "" {
			return MessageError("Cần mật khẩu hoặc khóa riêng (private key) SFTP")
		}
		if t.Secret.PrivateKey != "" && !strings.Contains(t.Secret.PrivateKey, "PRIVATE KEY") {
			return MessageError("Khóa riêng phải ở dạng PEM (-----BEGIN … PRIVATE KEY-----)")
		}
	case KindS3:
		if !contains(S3Providers, st.Provider) {
			return MessageError("Nhà cung cấp S3 không hợp lệ")
		}
		if err := need(st.Bucket, "bucket"); err != nil {
			return err
		}
		if err := need(st.AccessKeyID, "access key ID"); err != nil {
			return err
		}
		if err := need(t.Secret.SecretKey, "secret access key"); err != nil {
			return err
		}
		if st.Provider != "AWS" && st.Endpoint == "" {
			return MessageError("Cần endpoint của nhà cung cấp S3 (vd s3.us-west-004.backblazeb2.com)")
		}
		if st.Endpoint != "" {
			if u, err := url.Parse(withScheme(st.Endpoint)); err != nil || u.Host == "" {
				return MessageError("Endpoint S3 không hợp lệ")
			}
		}
	case KindDrive, KindOneDrive, KindDropbox:
		var tok map[string]any
		if err := json.Unmarshal([]byte(t.Secret.Token), &tok); err != nil || tok["refresh_token"] == nil && tok["access_token"] == nil {
			return MessageError("Token không hợp lệ: dán nguyên dòng JSON mà lệnh rclone authorize in ra")
		}
	default:
		return MessageError("Loại đích không hợp lệ")
	}
	for _, line := range strings.Split(strings.TrimSpace(st.HostKey), "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "#") && len(strings.Fields(line)) < 3 {
			return MessageError("Khóa máy chủ SFTP: dán nguyên các dòng mà ssh-keyscan in ra (máy-chủ loại-khóa khóa)")
		}
	}
	for _, v := range []string{st.Host, st.User, st.Provider, st.Endpoint, st.Region, st.Bucket, st.AccessKeyID, st.DriveID, st.DriveType} {
		if strings.ContainsAny(v, "\r\n") {
			return MessageError("Giá trị không được xuống dòng")
		}
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func withScheme(s string) string {
	if strings.Contains(s, "://") {
		return s
	}
	return "https://" + s
}

// Rclone runs the rclone binary ("" = rclone in PATH).
type Rclone struct{ Bin string }

func (r Rclone) bin() string {
	if r.Bin != "" {
		return r.Bin
	}
	return "rclone"
}

// session is one destination opened for a few rclone calls: a private temporary directory with its config.
type session struct {
	r      Rclone
	dir    string
	config string
	root   string // "ntb:" + path
	token  string // the token written, to see whether rclone refreshed it
}

func iniValue(v string) string { return strings.ReplaceAll(v, "\n", `\n`) }

func (r Rclone) open(ctx context.Context, t Target) (*session, error) {
	dir, err := os.MkdirTemp("", "ntb-rclone-*")
	if err != nil {
		return nil, fmt.Errorf("rclone temp dir: %w", err)
	}
	s := &session{r: r, dir: dir, config: filepath.Join(dir, "rclone.conf")}
	st, sec := t.Settings, t.Secret
	lines := []string{"[ntb]", "type = " + t.Kind}
	add := func(k, v string) {
		if v != "" {
			lines = append(lines, k+" = "+iniValue(v))
		}
	}
	path := strings.Trim(st.Path, "/")
	switch t.Kind {
	case KindLocal:
		path = st.Path // absolute
	case KindSFTP:
		add("host", st.Host)
		if st.Port > 0 {
			add("port", strconv.Itoa(st.Port))
		}
		add("user", st.User)
		if sec.Password != "" {
			obscured, err := r.obscure(ctx, sec.Password)
			if err != nil {
				s.close()
				return nil, err
			}
			add("pass", obscured)
		}
		add("key_pem", strings.TrimSpace(sec.PrivateKey))
		if st.HostKey != "" {
			kh := filepath.Join(dir, "known_hosts")
			if err := os.WriteFile(kh, []byte(strings.TrimSpace(st.HostKey)+"\n"), 0o600); err != nil {
				s.close()
				return nil, fmt.Errorf("known_hosts: %w", err)
			}
			add("known_hosts_file", kh)
		}
	case KindS3:
		add("provider", st.Provider)
		add("access_key_id", st.AccessKeyID)
		add("secret_access_key", sec.SecretKey)
		add("region", st.Region)
		add("endpoint", st.Endpoint)
		// The key may write objects without being allowed to create / list buckets.
		add("no_check_bucket", "true")
		path = strings.Trim(st.Bucket+"/"+path, "/")
	case KindDrive, KindDropbox:
		add("token", sec.Token)
		s.token = sec.Token
	case KindOneDrive:
		add("token", sec.Token)
		add("drive_id", st.DriveID)
		add("drive_type", st.DriveType)
		s.token = sec.Token
	}
	if err := os.WriteFile(s.config, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		s.close()
		return nil, fmt.Errorf("rclone config: %w", err)
	}
	s.root = "ntb:" + path
	return s, nil
}

// close deletes the temporary config; the refreshed OAuth token (if rclone rotated it) is returned.
func (s *session) close() (refreshed string) {
	if s.token != "" {
		if f, err := os.Open(s.config); err == nil {
			sc := bufio.NewScanner(f)
			sc.Buffer(make([]byte, 64<<10), 1<<20)
			for sc.Scan() {
				if k, v, ok := strings.Cut(sc.Text(), "="); ok && strings.TrimSpace(k) == "token" {
					if v = strings.TrimSpace(v); v != s.token {
						refreshed = v
					}
				}
			}
			_ = f.Close()
		}
	}
	_ = os.RemoveAll(s.dir)
	return refreshed
}

func (s *session) file(name string) string {
	if strings.HasSuffix(s.root, ":") {
		return s.root + name
	}
	return s.root + "/" + name
}

func (s *session) run(ctx context.Context, stdin string, args ...string) (string, error) {
	base := []string{"--config", s.config, "--retries", "3", "--low-level-retries", "5", "--contimeout", "30s",
		"--timeout", "10m", "--stats", "0", "-q"}
	cmd := exec.CommandContext(ctx, s.r.bin(), append(base, args...)...)
	// Only the config given counts (no RCLONE_* settings of the host leak in).
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + s.dir, "TMPDIR=" + os.TempDir()}
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	stderr := &limited{}
	cmd.Stderr = stderr
	out, err := cmd.Output()
	if err != nil {
		return "", toolError("rclone "+args[0], err, stderr)
	}
	return string(out), nil
}

func (r Rclone) obscure(ctx context.Context, secret string) (string, error) {
	cmd := exec.CommandContext(ctx, r.bin(), "obscure", "-")
	cmd.Stdin = strings.NewReader(secret)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("rclone obscure: %w (is rclone installed?)", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// Test checks a destination can be written: creates the folder, writes and deletes a small file. A bucket with
// Object Lock may keep the small file until its retention ends.
func (r Rclone) Test(ctx context.Context, t Target) (refreshed string, err error) {
	s, err := r.open(ctx, t)
	if err != nil {
		return "", err
	}
	defer func() { refreshed = s.close() }()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if t.Kind != KindS3 {
		if _, err := s.run(ctx, "", "mkdir", s.root); err != nil {
			return "", err
		}
	}
	probe := s.file(".ntb-write-test")
	if _, err := s.run(ctx, "ok "+time.Now().UTC().Format(time.RFC3339)+"\n", "rcat", probe); err != nil {
		return "", err
	}
	_, _ = s.run(ctx, "", "deletefile", probe)
	return "", nil
}

// ShipResult is what happened on one destination.
type ShipResult struct {
	Target  Target
	Err     error
	Deleted int
	// DeleteErrors: old files the destination refused to delete (Object Lock retention) — not a failure.
	DeleteErrors int
	Refreshed    string
}

// Ship copies a backup file to a destination and applies the destination's retention to the backups there.
func (r Rclone) Ship(ctx context.Context, t Target, local string) (res ShipResult) {
	res.Target = t
	s, err := r.open(ctx, t)
	if err != nil {
		res.Err = err
		return res
	}
	defer func() { res.Refreshed = s.close() }()
	name := filepath.Base(local)
	if _, err := s.run(ctx, "", "copyto", local, s.file(name)); err != nil {
		res.Err = err
		return res
	}
	out, err := s.run(ctx, "", "lsf", "--files-only", s.root)
	if err != nil {
		res.Err = fmt.Errorf("list after upload: %w", err)
		return res
	}
	var files []File
	for _, line := range strings.Split(out, "\n") {
		if f, ok := ParseFileName(strings.TrimSpace(line)); ok {
			files = append(files, f)
		}
	}
	_, drop := Prune(files, t.Keep)
	for _, f := range drop {
		if f.Name == name {
			continue
		}
		if _, err := s.run(ctx, "", "deletefile", s.file(f.Name)); err != nil {
			res.DeleteErrors++
			continue
		}
		res.Deleted++
	}
	return res
}

// OneDriveDrive finds the default drive of a freshly authorized OneDrive token (rclone needs its id and type).
func OneDriveDrive(ctx context.Context, token string) (id, kind string, err error) {
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal([]byte(token), &tok); err != nil || tok.AccessToken == "" {
		return "", "", MessageError("Token OneDrive không hợp lệ")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.microsoft.com/v1.0/me/drive", nil)
	if err != nil {
		return "", "", fmt.Errorf("onedrive: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", MessageError("Không hỏi được OneDrive: " + err.Error())
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", "", MessageError(fmt.Sprintf("OneDrive từ chối token (HTTP %d) — token chỉ dùng được trong 1 giờ sau khi chạy rclone authorize, chạy lại rồi dán ngay", resp.StatusCode))
	}
	var d struct {
		ID        string `json:"id"`
		DriveType string `json:"driveType"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&d); err != nil || d.ID == "" {
		return "", "", MessageError("OneDrive không trả về ổ đĩa")
	}
	return d.ID, d.DriveType, nil
}
