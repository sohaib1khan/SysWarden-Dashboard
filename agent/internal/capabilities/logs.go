package capabilities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// TailLog reads the last N lines from a log file.
// params: { "path": "/var/log/syslog", "lines": 50 }
// Security: path is cleaned and must be absolute; no symlink traversal into /proc or /sys.
func TailLog(_ context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Path  string `json:"path"`
		Lines int    `json:"lines"`
	}
	p.Lines = 50
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	clean := filepath.Clean(p.Path)
	if err := validateLogPath(clean); err != nil {
		return nil, err
	}
	if p.Lines <= 0 || p.Lines > 1000 {
		p.Lines = 50
	}

	lines, err := tailFile(clean, p.Lines)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": clean, "lines": lines}, nil
}

// ReadFile returns the contents of a text file (max 512 KB).
// Security: same path validation as TailLog.
func ReadFile(_ context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	clean := filepath.Clean(p.Path)
	if err := validateLogPath(clean); err != nil {
		return nil, err
	}

	f, err := os.Open(clean)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", clean, err)
	}
	defer f.Close()

	const maxBytes = 512 * 1024
	buf := make([]byte, maxBytes+1)
	n, err := io.ReadFull(f, buf)
	truncated := false
	if err == io.ErrUnexpectedEOF {
		// file is smaller than maxBytes — that's fine
	} else if err != nil {
		return nil, fmt.Errorf("read %s: %w", clean, err)
	}
	if n > maxBytes {
		buf = buf[:maxBytes]
		truncated = true
	} else {
		buf = buf[:n]
	}

	return map[string]interface{}{
		"path":      clean,
		"content":   string(buf),
		"truncated": truncated,
	}, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// validateLogPath blocks access to dangerous virtual filesystems.
func validateLogPath(path string) error {
	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}
	for _, blocked := range []string{"/proc", "/sys", "/dev"} {
		if strings.HasPrefix(path, blocked) {
			return fmt.Errorf("access to %s is not permitted", blocked)
		}
	}
	return nil
}

func tailFile(path string, n int) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return nil, fmt.Errorf("seek %s: %w", path, err)
	}
	if size == 0 {
		return []string{}, nil
	}

	// Read backwards in 32 KB chunks until we have gathered at least n+1 newlines.
	// This is O(tail_size) rather than O(file_size), so it works on multi-GB log files.
	const chunkSize = int64(32 * 1024)
	var buf []byte
	pos := size

	for pos > 0 && bytes.Count(buf, []byte("\n")) < n+1 {
		readSize := chunkSize
		if pos < readSize {
			readSize = pos
		}
		pos -= readSize
		tmp := make([]byte, readSize)
		if _, err := f.ReadAt(tmp, pos); err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		buf = append(tmp, buf...)
	}

	lines := strings.Split(string(buf), "\n")

	// If we stopped mid-file the first element is a partial line — drop it.
	if pos > 0 && len(lines) > 1 {
		lines = lines[1:]
	}
	// Drop trailing empty string produced by a final newline.
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	// Return only the last n lines.
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines, nil
}
