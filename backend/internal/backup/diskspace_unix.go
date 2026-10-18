//go:build unix

package backup

import "syscall"

// freeBytes is the space left for an unprivileged user on the file system holding dir (-1: unknown).
func freeBytes(dir string) int64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return -1
	}
	return int64(st.Bavail) * int64(st.Bsize) //nolint:unconvert // field types differ per OS
}
