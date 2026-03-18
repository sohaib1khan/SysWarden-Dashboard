// Package relay handles all communication between the agent and the
// SysWarden backend: REST for registration and metric ingest (Phase 1 fallback),
// and a persistent WebSocket connection for bidirectional capability relay (Phase 2).
package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const httpTimeout = 10 * time.Second

// Client wraps all backend HTTP calls.
type Client struct {
	baseURL    string
	agentID    string
	apiKey     string
	httpClient *http.Client
}

func NewClient(baseURL, agentID, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		agentID: agentID,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: httpTimeout,
		},
	}
}

// RegisterRequest is sent to POST /api/v1/agents/register.
type RegisterRequest struct {
	Hostname     string   `json:"hostname"`
	Capabilities []string `json:"capabilities"`
}

// RegisterResponse is the server response — agent_id + plaintext api_key.
type RegisterResponse struct {
	AgentID string `json:"agent_id"`
	APIKey  string `json:"api_key"`
}

// Register calls the registration endpoint and returns the server-issued
// agent_id and api_key. The caller is responsible for persisting the key.
func (c *Client) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	resp, err := c.post(ctx, "/api/v1/agents/register", body, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("registration failed: HTTP %d", resp.StatusCode)
	}

	var result RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

// IngestRequest mirrors the backend's MetricIngestRequest schema.
type IngestRequest struct {
	AgentID string      `json:"agent_id"`
	Metrics interface{} `json:"metrics"`
}

// SendMetrics POSTs a batch of metric points to the backend.
func (c *Client) SendMetrics(ctx context.Context, metrics interface{}) error {
	payload := IngestRequest{
		AgentID: c.agentID,
		Metrics: metrics,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	resp, err := c.post(ctx, "/api/v1/metrics", body, c.apiKey)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("ingest failed: HTTP %d", resp.StatusCode)
	}
	return nil
}

// ── internal ──────────────────────────────────────────────────────────────────

func (c *Client) post(ctx context.Context, path string, body []byte, apiKey string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("X-Api-Key", apiKey)
	}
	return c.httpClient.Do(req)
}

// ─── Plugin registry ──────────────────────────────────────────────────────────

// pluginManifestJSON is the wire format for announcing a plugin.
type pluginManifestJSON struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	Description     string `json:"description"`
	Author          string `json:"author"`
	IntervalSeconds int    `json:"interval_seconds"`
	OutputSchema    string `json:"output_schema"`
}

// PluginAnnouncer is satisfied by plugins.Manifest for the announce call.
type PluginAnnouncer interface {
	GetName() string
	GetVersion() string
	GetDescription() string
	GetAuthor() string
	GetIntervalSeconds() int
	GetOutputSchema() string
}

type announceRequest struct {
	AgentID string               `json:"agent_id"`
	Plugins []pluginManifestJSON `json:"plugins"`
}

// AnnouncePlugins tells the backend about plugins discovered on this agent.
// manifests is []plugins.Manifest — passed as interface{} to avoid import cycle.
func (c *Client) AnnouncePlugins(ctx context.Context, agentID string, manifests interface{}) error {
	type manifest interface {
		GetName() string
		GetVersion() string
		GetDescription() string
		GetAuthor() string
		GetIntervalSeconds() int
		GetOutputSchema() string
	}

	// Use JSON round-trip to avoid import cycle between relay and plugins packages.
	raw, err := json.Marshal(manifests)
	if err != nil {
		return err
	}
	var items []struct {
		Name            string `json:"Name"`
		Version         string `json:"Version"`
		Description     string `json:"Description"`
		Author          string `json:"Author"`
		IntervalSeconds int    `json:"IntervalSeconds"`
		OutputSchema    string `json:"OutputSchema"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return err
	}

	pm := make([]pluginManifestJSON, len(items))
	for i, it := range items {
		pm[i] = pluginManifestJSON{
			Name:            it.Name,
			Version:         it.Version,
			Description:     it.Description,
			Author:          it.Author,
			IntervalSeconds: it.IntervalSeconds,
			OutputSchema:    it.OutputSchema,
		}
	}

	body, err := json.Marshal(announceRequest{AgentID: agentID, Plugins: pm})
	if err != nil {
		return err
	}

	resp, err := c.post(ctx, "/api/v1/plugins/announce", body, c.apiKey)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 {
		return fmt.Errorf("announce failed: HTTP %d", resp.StatusCode)
	}
	return nil
}

// TouchPlugin updates the plugin's last_seen timestamp on the backend.
func (c *Client) TouchPlugin(ctx context.Context, agentID, pluginName string) error {
	body, err := json.Marshal(map[string]string{
		"agent_id":    agentID,
		"plugin_name": pluginName,
	})
	if err != nil {
		return err
	}
	resp, err := c.post(ctx, "/api/v1/plugins/touch", body, c.apiKey)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// ── Plugin sync (backend-pushed scripts) ──────────────────────────────────────

// get sends a GET to path with agent auth headers.
func (c *Client) get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", c.apiKey)
	req.Header.Set("X-Agent-Id", c.agentID)
	return c.httpClient.Do(req)
}

// FetchPluginSync returns raw JSON bytes listing all enabled backend scripts.
// Agents call this to detect new or changed scripts without downloading them all.
func (c *Client) FetchPluginSync(ctx context.Context) ([]byte, error) {
	resp, err := c.get(ctx, "/api/v1/agent/plugins/sync")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plugin sync: HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// FetchPluginDownload returns the raw script content for the named backend plugin.
func (c *Client) FetchPluginDownload(ctx context.Context, name string) ([]byte, error) {
	resp, err := c.get(ctx, "/api/v1/agent/plugins/download/"+name)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plugin download %q: HTTP %d", name, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// UpdateCapabilities persists the agent's current full capability set on the backend.
// Called by the plugin loader after dynamically registering new capability-type handlers.
func (c *Client) UpdateCapabilities(ctx context.Context, caps []string) error {
	type reqBody struct {
		Capabilities []string `json:"capabilities"`
	}
	b, err := json.Marshal(reqBody{Capabilities: caps})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, c.baseURL+"/api/v1/agents/"+c.agentID+"/capabilities", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("update capabilities: HTTP %d", resp.StatusCode)
	}
	return nil
}
