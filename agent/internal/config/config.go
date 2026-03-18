package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds all agent settings. Values come from env vars first,
// then from the persisted key file. Nothing is hardcoded.
type Config struct {
	BackendURL string
	AgentID    string
	APIKey     string
	Interval   int // seconds between metric pushes
	KeyFile    string
	PluginsDir string // directory to scan for plugin scripts
}

// defaultBackendURL is used when SYSWARDEN_BACKEND_URL is not set.
// Override with the SYSWARDEN_BACKEND_URL environment variable.
const defaultBackendURL = "http://localhost:8000"

// Load reads config from environment, falling back to the key file for
// AgentID and APIKey. Falls back to defaultBackendURL if SYSWARDEN_BACKEND_URL is unset.
func Load() (*Config, error) {
	backendURL := os.Getenv("SYSWARDEN_BACKEND_URL")
	if backendURL == "" {
		backendURL = defaultBackendURL
	}
	backendURL = strings.TrimRight(backendURL, "/")

	interval := 10
	if raw := os.Getenv("SYSWARDEN_INTERVAL"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			interval = v
		}
	}

	keyFile := defaultKeyPath()

	pluginsDir := os.Getenv("SYSWARDEN_PLUGINS_DIR")
	if pluginsDir == "" {
		pluginsDir = "./plugins"
	}

	cfg := &Config{
		BackendURL: backendURL,
		AgentID:    os.Getenv("SYSWARDEN_AGENT_ID"),
		APIKey:     os.Getenv("SYSWARDEN_API_KEY"),
		Interval:   interval,
		KeyFile:    keyFile,
		PluginsDir: pluginsDir,
	}

	// Fall back to persisted credentials if not in env
	if cfg.AgentID == "" || cfg.APIKey == "" {
		if id, key, err := readKeyFile(keyFile); err == nil {
			if cfg.AgentID == "" {
				cfg.AgentID = id
			}
			if cfg.APIKey == "" {
				cfg.APIKey = key
			}
		}
	}

	return cfg, nil
}

// PersistCredentials writes agent_id and api_key to disk at mode 0600.
// The directory is created if it does not exist.
func PersistCredentials(keyFile, agentID, apiKey string) error {
	if err := os.MkdirAll(filepath.Dir(keyFile), 0700); err != nil {
		return err
	}
	content := fmt.Sprintf("%s\n%s\n", agentID, apiKey)
	return os.WriteFile(keyFile, []byte(content), 0600)
}

// ── internal helpers ──────────────────────────────────────────────────────────

func defaultKeyPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	return filepath.Join(home, ".syswarden", "agent.key")
}

func readKeyFile(path string) (agentID, apiKey string, err error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
	if len(lines) != 2 {
		return "", "", fmt.Errorf("malformed key file")
	}
	return strings.TrimSpace(lines[0]), strings.TrimSpace(lines[1]), nil
}
