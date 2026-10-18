package backup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Real SFTP / S3 servers, when given (manual check, e.g. throw-away atmoz/sftp and minio containers):
//
//	NTB_TEST_SFTP=host|port|user|password|known_hosts line  NTB_TEST_S3=endpoint|bucket|access|secret
func TestRcloneRemotes(t *testing.T) {
	if _, err := exec.LookPath("rclone"); err != nil {
		t.Skip("rclone not installed")
	}
	var targets []Target
	if v := os.Getenv("NTB_TEST_SFTP"); v != "" {
		p := splitN(v, 5)
		port, _ := strconv.Atoi(p[1])
		targets = append(targets, Target{Kind: KindSFTP, Name: "sftp", Keep: DefaultPolicy,
			Settings: TargetSettings{Host: p[0], Port: port, User: p[2], Path: "upload/ntb", HostKey: p[4]}, Secret: TargetSecret{Password: p[3]}})
	}
	if v := os.Getenv("NTB_TEST_S3"); v != "" {
		p := splitN(v, 4)
		targets = append(targets, Target{Kind: KindS3, Name: "s3", Keep: DefaultPolicy,
			Settings: TargetSettings{Provider: "Minio", Endpoint: "http://" + p[0], Bucket: p[1], AccessKeyID: p[2], Path: "ntb"}, Secret: TargetSecret{SecretKey: p[3]}})
	}
	if len(targets) == 0 {
		t.Skip("NTB_TEST_SFTP / NTB_TEST_S3 not set")
	}
	file := filepath.Join(t.TempDir(), FileName(time.Now(), "manual"))
	if err := os.WriteFile(file, []byte("encrypted backup bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := Rclone{}
	for _, tg := range targets {
		if err := tg.Validate(); err != nil {
			t.Errorf("%s: validate: %v", tg.Name, err)
		}
		if _, err := r.Test(context.Background(), tg); err != nil {
			t.Errorf("%s: test: %v", tg.Name, err)
		}
		if res := r.Ship(context.Background(), tg, file); res.Err != nil {
			t.Errorf("%s: ship: %v", tg.Name, res.Err)
		}
		bad := tg
		bad.Secret.Password, bad.Secret.SecretKey = "wrong-password", "wrong-secret"
		if _, err := r.Test(context.Background(), bad); err == nil {
			t.Errorf("%s: wrong credentials accepted", tg.Name)
		}
	}
}

func splitN(s string, n int) []string {
	out := strings.SplitN(s, "|", n)
	for len(out) < n {
		out = append(out, "")
	}
	return out
}
