// Package plugins implements the Phase 5 plugin loader.
//
// Plugins are executable scripts placed in ./plugins/ (or the path configured
// via SYSWARDEN_PLUGINS_DIR). Each script declares its manifest in header
// comment lines using the format:
//
//	# PLUGIN_NAME: ping_check
//	# PLUGIN_VERSION: 1.0.0
//	# PLUGIN_DESCRIPTION: Check latency to a host
//	# PLUGIN_INTERVAL: 30
//	# PLUGIN_AUTHOR: SysWarden
//	# PLUGIN_OUTPUT_SCHEMA: {"latency_ms":"float","packet_loss":"float"}
//
// Two plugin types are supported (set via PLUGIN_TYPE header):
//
//	metric     — script runs on a schedule and writes JSON metrics to stdout.
//	             (default if PLUGIN_TYPE is absent)
//	capability — script is invoked on demand; receives JSON params on stdin and
//	             writes a JSON response to stdout. Registered as a live
//	             CapabilityHandler in the HandlerRegistry.
//
// For capability plugins the capability name must be declared:
//
//	# PLUGIN_TYPE: capability
//	# PLUGIN_CAPABILITY: custom.my_check
//
// Backend-stored scripts:
//
// The loader also polls /api/v1/agent/plugins/sync every 60 s to detect
// backend-managed scripts that should be deployed to this agent. Changed
// scripts are downloaded, written to the plugins directory, and (for
// capability type) registered as live handlers immediately — no binary
// redeploy required.
package plugins

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Manifest holds the metadata parsed from a plugin script's header comments.
type Manifest struct {
	Name            string
	Version         string
	Description     string
	Author          string
	IntervalSeconds int
	OutputSchema    string
	ScriptPath      string
	// Type is "metric" (default) or "capability".
	Type string
	// CapabilityName is the handler name registered when Type == "capability".
	CapabilityName string
}

// MetricPoint is the output format expected from metric plugin scripts.
type MetricPoint struct {
	Name      string    `json:"name"`
	Value     float64   `json:"value"`
	Unit      string    `json:"unit,omitempty"`
	Timestamp time.Time `json:"timestamp,omitempty"`
}

// HTTPClient is the minimal interface the loader needs from relay.Client.
// Returning raw []byte for the sync/download methods avoids an import cycle.
type HTTPClient interface {
	SendMetrics(ctx context.Context, metrics interface{}) error
	AnnouncePlugins(ctx context.Context, agentID string, manifests interface{}) error
	TouchPlugin(ctx context.Context, agentID, pluginName string) error
	FetchPluginSync(ctx context.Context) ([]byte, error)
	FetchPluginDownload(ctx context.Context, name string) ([]byte, error)
	UpdateCapabilities(ctx context.Context, caps []string) error
}

// HandlerRegistrar is satisfied by relay.HandlerRegistry. Defined here (in the
// plugins package) to avoid a circular import between plugins ↔ relay.
type HandlerRegistrar interface {
	SetHandler(name string, h func(context.Context, json.RawMessage) (interface{}, error))
	Names() []string
}

// pluginSyncEntry is the wire format returned by /api/v1/agent/plugins/sync.
type pluginSyncEntry struct {
	Name           string `json:"name"`
	Checksum       string `json:"checksum"`
	Version        string `json:"version"`
	PluginType     string `json:"plugin_type"`
	CapabilityName string `json:"capability_name"`
}

const (
	defaultInterval    = 60
	maxRunTimeout      = 30 * time.Second
	announceRetryDelay = 5 * time.Second
	syncInterval       = 60 * time.Second
)

// Loader discovers and runs plugin scripts.
type Loader struct {
	pluginsDir     string
	agentID        string
	client         HTTPClient
	registry       HandlerRegistrar
	localChecksums map[string]string // script name → last-known SHA-256
}

// New creates a Loader. pluginsDir defaults to "./plugins" if empty.
func New(pluginsDir, agentID string, client HTTPClient, registry HandlerRegistrar) *Loader {
	if pluginsDir == "" {
		pluginsDir = "./plugins"
	}
	return &Loader{
		pluginsDir:     pluginsDir,
		agentID:        agentID,
		client:         client,
		registry:       registry,
		localChecksums: make(map[string]string),
	}
}

// Run discovers plugins, announces them, then runs each in its own goroutine.
// Also starts a background goroutine that polls the backend for new scripts.
// Blocks until ctx is cancelled.
func (l *Loader) Run(ctx context.Context) {
	manifests, err := l.Discover()
	if err != nil {
		log.Printf("[plugins] discover error: %v", err)
	}

	if len(manifests) > 0 {
		log.Printf("[plugins] found %d plugin(s): %s", len(manifests), pluginNames(manifests))

		// Announce to backend with retries
		go func() {
			for {
				if err := l.client.AnnouncePlugins(ctx, l.agentID, manifests); err != nil {
					log.Printf("[plugins] announce failed: %v — retrying in %s", err, announceRetryDelay)
					select {
					case <-ctx.Done():
						return
					case <-time.After(announceRetryDelay):
					}
					continue
				}
				log.Printf("[plugins] announced %d plugin(s) to backend", len(manifests))
				return
			}
		}()

		// Start one runner goroutine per metric plugin
		for _, m := range manifests {
			m := m
			if m.Type == "capability" {
				// Register as on-demand handler instead of scheduled runner
				path := m.ScriptPath
				capName := m.CapabilityName
				if capName == "" {
					capName = m.Name
				}
				l.registry.SetHandler(capName, makeCapabilityHandler(path))
				log.Printf("[plugins] registered capability handler %q from local script %s", capName, path)
			} else {
				go l.runPlugin(ctx, m)
			}
		}
	} else {
		log.Printf("[plugins] no plugins found in %s", l.pluginsDir)
	}

	// Backend sync loop — pulls new/updated scripts from the backend store
	go l.syncLoop(ctx)

	<-ctx.Done()
}

// Discover scans the plugins directory and parses manifests from all
// executable files it finds.
func (l *Loader) Discover() ([]Manifest, error) {
	entries, err := os.ReadDir(l.pluginsDir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read plugins dir %q: %w", l.pluginsDir, err)
	}

	var manifests []Manifest
	seen := make(map[string]bool)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(l.pluginsDir, e.Name())
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Mode()&0o111 == 0 {
			continue
		}
		m, err := ParseManifest(path)
		if err != nil {
			log.Printf("[plugins] skipping %s: %v", path, err)
			continue
		}
		if seen[m.Name] {
			log.Printf("[plugins] skipping duplicate %s (already loaded as %q)", e.Name(), m.Name)
			continue
		}
		seen[m.Name] = true
		manifests = append(manifests, m)
	}
	return manifests, nil
}

// ── Metric plugin runner ──────────────────────────────────────────────────────

func (l *Loader) runPlugin(ctx context.Context, m Manifest) {
	interval := time.Duration(m.IntervalSeconds) * time.Second
	log.Printf("[plugins] starting %q every %s", m.Name, interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	l.executeOnce(ctx, m)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.executeOnce(ctx, m)
		}
	}
}

func (l *Loader) executeOnce(ctx context.Context, m Manifest) {
	runCtx, cancel := context.WithTimeout(ctx, maxRunTimeout)
	defer cancel()

	// #nosec G204 — script path comes from a controlled plugins directory
	cmd := exec.CommandContext(runCtx, m.ScriptPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		log.Printf("[plugins] %s run error: %v — stderr: %s", m.Name, err, stderr.String())
		return
	}

	metrics, err := parseOutput(m.Name, stdout.Bytes())
	if err != nil {
		log.Printf("[plugins] %s parse error: %v — output: %s", m.Name, err, stdout.String())
		return
	}
	if len(metrics) == 0 {
		return
	}

	now := time.Now().UTC()
	for i := range metrics {
		if metrics[i].Timestamp.IsZero() {
			metrics[i].Timestamp = now
		}
	}

	if err := l.client.SendMetrics(ctx, metrics); err != nil {
		log.Printf("[plugins] %s send metrics error: %v", m.Name, err)
		return
	}
	_ = l.client.TouchPlugin(ctx, l.agentID, m.Name)
}

// ── Backend sync loop ─────────────────────────────────────────────────────────

func (l *Loader) syncLoop(ctx context.Context) {
	// Run once immediately on startup so the agent picks up scripts before the
	// first WS connection is fully established.
	l.syncOnce(ctx)

	ticker := time.NewTicker(syncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.syncOnce(ctx)
		}
	}
}

func (l *Loader) syncOnce(ctx context.Context) {
	raw, err := l.client.FetchPluginSync(ctx)
	if err != nil {
		log.Printf("[plugins] sync list failed: %v", err)
		return
	}

	var entries []pluginSyncEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		log.Printf("[plugins] sync list parse: %v", err)
		return
	}

	// Ensure the plugins directory exists
	if err := os.MkdirAll(l.pluginsDir, 0o750); err != nil {
		log.Printf("[plugins] cannot create plugins dir: %v", err)
		return
	}

	capabilitiesUpdated := false

	for _, entry := range entries {
		scriptPath := filepath.Join(l.pluginsDir, entry.Name)

		// Check whether we already have an up-to-date copy.
		// Also check extension-bearing variants (.sh, .py) so scripts that were
		// installed locally with an extension aren't re-downloaded without one.
		localSum := l.localChecksums[entry.Name]
		if localSum == "" {
			for _, ext := range []string{"", ".sh", ".py"} {
				if sum := fileChecksum(filepath.Join(l.pluginsDir, entry.Name+ext)); sum != "" {
					localSum = sum
					break
				}
			}
		}
		if localSum == entry.Checksum {
			continue // already current
		}

		// Download the updated script
		content, err := l.client.FetchPluginDownload(ctx, entry.Name)
		if err != nil {
			log.Printf("[plugins] download %q: %v", entry.Name, err)
			continue
		}

		// Verify checksum before writing to disk
		downloaded := hex.EncodeToString(sha256.New().Sum([]byte{}))
		h := sha256.New()
		h.Write(content)
		downloaded = hex.EncodeToString(h.Sum(nil))
		if downloaded != entry.Checksum {
			log.Printf("[plugins] checksum mismatch for %q (got %s want %s) — skipping",
				entry.Name, downloaded, entry.Checksum)
			continue
		}

		// Write to disk with executable bit
		if err := os.WriteFile(scriptPath, content, 0o750); err != nil { // #nosec G306
			log.Printf("[plugins] write %q: %v", scriptPath, err)
			continue
		}
		l.localChecksums[entry.Name] = entry.Checksum
		log.Printf("[plugins] synced script %q (v%s)", entry.Name, entry.Version)

		// Register capability-type scripts as live handlers immediately
		if entry.PluginType == "capability" && entry.CapabilityName != "" {
			l.registry.SetHandler(entry.CapabilityName, makeCapabilityHandler(scriptPath))
			log.Printf("[plugins] registered dynamic capability %q", entry.CapabilityName)
			capabilitiesUpdated = true
		}
	}

	// Notify the backend of the updated capability list so the dashboard stays accurate
	if capabilitiesUpdated {
		if err := l.client.UpdateCapabilities(ctx, l.registry.Names()); err != nil {
			log.Printf("[plugins] update capabilities: %v", err)
		}
	}
}

// makeCapabilityHandler returns a CapabilityHandler that runs scriptPath,
// writes params JSON to stdin, and returns the script's stdout as the result.
func makeCapabilityHandler(scriptPath string) func(context.Context, json.RawMessage) (interface{}, error) {
	return func(ctx context.Context, params json.RawMessage) (interface{}, error) {
		runCtx, cancel := context.WithTimeout(ctx, maxRunTimeout)
		defer cancel()

		// #nosec G204 — path comes from the controlled plugins directory
		cmd := exec.CommandContext(runCtx, scriptPath)
		if len(params) > 0 {
			cmd.Stdin = bytes.NewReader(params)
		}
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("script %s: %v — stderr: %s", filepath.Base(scriptPath), err, stderr.String())
		}

		var result interface{}
		if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
			return nil, fmt.Errorf("script %s: JSON parse: %v — output: %.200s", filepath.Base(scriptPath), err, stdout.String())
		}
		return result, nil
	}
}

// fileChecksum returns the SHA-256 hex digest of a file, or "" if unreadable.
func fileChecksum(path string) string {
	data, err := os.ReadFile(path) // #nosec G304 — controlled plugins directory
	if err != nil {
		return ""
	}
	h := sha256.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

// ── Output parsing ────────────────────────────────────────────────────────────

func parseOutput(pluginName string, data []byte) ([]MetricPoint, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return nil, nil
	}
	if bytes.HasPrefix(data, []byte("[")) {
		var pts []MetricPoint
		if err := json.Unmarshal(data, &pts); err != nil {
			return nil, fmt.Errorf("JSON array parse: %w", err)
		}
		return prefixNames(pluginName, pts), nil
	}
	if bytes.HasPrefix(data, []byte("{")) {
		var pt MetricPoint
		if err := json.Unmarshal(data, &pt); err != nil {
			return nil, fmt.Errorf("JSON object parse: %w", err)
		}
		return prefixNames(pluginName, []MetricPoint{pt}), nil
	}
	return nil, fmt.Errorf("output must be a JSON object or array, got: %.40s…", data)
}

func prefixNames(pluginName string, pts []MetricPoint) []MetricPoint {
	prefix := pluginName + "."
	for i := range pts {
		if !strings.HasPrefix(pts[i].Name, prefix) {
			pts[i].Name = prefix + pts[i].Name
		}
	}
	return pts
}

// ParseManifest opens a script file and reads the PLUGIN_* header comments.
func ParseManifest(path string) (Manifest, error) {
	f, err := os.Open(path) // #nosec G304 — controlled plugins directory
	if err != nil {
		return Manifest{}, err
	}
	defer f.Close()

	m := Manifest{
		ScriptPath:      path,
		Version:         "1.0.0",
		IntervalSeconds: defaultInterval,
		OutputSchema:    "{}",
		Type:            "metric",
	}

	scanner := bufio.NewScanner(f)
	for i := 0; i < 30 && scanner.Scan(); i++ {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "#")
		line = strings.TrimSpace(line)

		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)

		switch strings.ToUpper(key) {
		case "PLUGIN_NAME":
			m.Name = val
		case "PLUGIN_VERSION":
			m.Version = val
		case "PLUGIN_DESCRIPTION":
			m.Description = val
		case "PLUGIN_AUTHOR":
			m.Author = val
		case "PLUGIN_INTERVAL":
			if n, err := strconv.Atoi(val); err == nil && n > 0 {
				m.IntervalSeconds = n
			}
		case "PLUGIN_OUTPUT_SCHEMA":
			m.OutputSchema = val
		case "PLUGIN_TYPE":
			m.Type = strings.ToLower(val)
		case "PLUGIN_CAPABILITY":
			m.CapabilityName = val
		}
	}

	if m.Name == "" {
		base := filepath.Base(path)
		m.Name = strings.TrimSuffix(base, filepath.Ext(base))
	}

	return m, nil
}

func pluginNames(manifests []Manifest) string {
	ns := make([]string, len(manifests))
	for i, m := range manifests {
		ns[i] = m.Name
	}
	return strings.Join(ns, ", ")
}

