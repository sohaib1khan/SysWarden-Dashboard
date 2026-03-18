package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

const (
	wsReconnectBase    = 2 * time.Second
	wsReconnectMax     = 30 * time.Second
	wsPingInterval     = 20 * time.Second
	wsPingTimeout      = 15 * time.Second  // generous — covers slow proxies and high-latency links
	wsHandshakeTimeout = 10 * time.Second
	wsReadLimit        = 8 << 20
	// Handshake-close reauth: require ≥3 consecutive failures sustained over
	// at least 2 minutes before assuming stale credentials. A brief network
	// blip that causes 2 quick failures should never trigger re-registration.
	wsReauthMinFailures = 3
	wsReauthMinDuration = 2 * time.Minute
)

// Message is the common envelope for all WebSocket messages.
type Message struct {
	Type        string          `json:"type"`
	AgentID     string          `json:"agent_id,omitempty"`
	APIKey      string          `json:"api_key,omitempty"`
	Capabilities []string       `json:"capabilities,omitempty"`
	Metrics     json.RawMessage `json:"metrics,omitempty"`
	Capability  string          `json:"capability,omitempty"`
	Params      json.RawMessage `json:"params,omitempty"`
	RequestID   string          `json:"request_id,omitempty"`
	Data        json.RawMessage `json:"data,omitempty"`
	Error       string          `json:"error,omitempty"`
}

// CapabilityHandler is a function the agent registers for a capability name.
// It receives the params JSON and returns a result or an error.
type CapabilityHandler func(ctx context.Context, params json.RawMessage) (interface{}, error)

// WSClient manages the persistent WebSocket connection to the backend.
type WSClient struct {
	backendURL   string
	agentID      string
	apiKey       string
	keyFile      string // path to persist rotated keys
	handlers     *HandlerRegistry
	metricsFn    func() (interface{}, error)       // called on each ping cycle to push metrics
	onKeyRotate  func(newKey string)               // called when server pushes a new_key message
	onReauth     func() (string, string, error)    // called on 4003 — delete keyfile, re-register, return (agentID, apiKey)
}

// ErrUnauthorized is returned by connect when the backend closes the WS handshake
// with a 4xxx close code (bad agent_id or api_key). RunForever uses this to trigger
// automatic re-registration instead of retrying with the same bad credentials.
var ErrUnauthorized = errors.New("agent unauthorized — credentials rejected")

// ErrHandshakeClose is returned when the server closes the connection during the
// handshake recv phase without a 4xxx close code. This happens when a proxy (e.g.
// nginx) strips custom WebSocket close codes. RunForever counts consecutive
// occurrences and triggers re-registration after a threshold.
var ErrHandshakeClose = errors.New("server closed connection during handshake")

func NewWSClient(
	backendURL, agentID, apiKey, keyFile string,
	handlers *HandlerRegistry,
	metricsFn func() (interface{}, error),
	onKeyRotate func(newKey string),
	onReauth func() (string, string, error),
) *WSClient {
	return &WSClient{
		backendURL:   backendURL,
		agentID:      agentID,
		apiKey:       apiKey,
		keyFile:      keyFile,
		handlers:     handlers,
		metricsFn:    metricsFn,
		onKeyRotate:  onKeyRotate,
		onReauth:     onReauth,
	}
}

// RunForever connects and maintains a persistent WS connection with
// exponential back-off on disconnection. Blocks until ctx is cancelled.
func (c *WSClient) RunForever(ctx context.Context) {
	delay := wsReconnectBase
	var (
		handshakeCloseCount int
		firstHandshakeFail  time.Time
	)
	for {
		if ctx.Err() != nil {
			return
		}
		err := c.connect(ctx)
		if err == nil {
			// Clean disconnect after a live session — reset everything.
			delay = wsReconnectBase
			handshakeCloseCount = 0
		} else if errors.Is(err, ErrUnauthorized) {
			// Server explicitly rejected credentials with a 4xxx close code.
			log.Printf("[ws] credentials rejected by server — re-registering")
			delay = wsReconnectBase
			handshakeCloseCount = 0
			c.doReauth()
		} else if errors.Is(err, ErrHandshakeClose) {
			// Server closed the connection during handshake without a 4xxx code.
			// Could be nginx stripping the 4003 close code, OR a transient network
			// blip. Only assume stale credentials after sustained failures.
			if handshakeCloseCount == 0 {
				firstHandshakeFail = time.Now()
			}
			handshakeCloseCount++
			sinceFirst := time.Since(firstHandshakeFail).Round(time.Second)
			log.Printf("[ws] handshake closed by server (attempt %d, %s since first) — reconnecting in %s",
				handshakeCloseCount, sinceFirst, delay)
			// Trigger reauth only after sustained failures
			// (≥wsReauthMinFailures attempts spread over ≥wsReauthMinDuration).
			// This prevents a brief network blip from incorrectly wiping valid credentials.
			if handshakeCloseCount >= wsReauthMinFailures && time.Since(firstHandshakeFail) >= wsReauthMinDuration {
				log.Printf("[ws] %d consecutive handshake closes over %s — assuming stale credentials, re-registering",
					handshakeCloseCount, sinceFirst)
				handshakeCloseCount = 0
				delay = wsReconnectBase
				c.doReauth()
			}
		} else {
			// Network error or mid-session drop — not an auth issue.
			handshakeCloseCount = 0
			log.Printf("[ws] disconnected: %v — reconnecting in %s", err, delay)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
			delay = min(delay*2, wsReconnectMax)
		}
	}
}

// doReauth invokes the reauth callback and updates in-memory credentials.
func (c *WSClient) doReauth() {
	if c.onReauth == nil {
		return
	}
	if newID, newKey, err := c.onReauth(); err == nil {
		c.agentID = newID
		c.apiKey = newKey
	} else {
		log.Printf("[ws] re-registration failed: %v", err)
	}
}

func (c *WSClient) connect(ctx context.Context) error {
	wsURL := toWSURL(c.backendURL) + "/ws/agent"

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		CompressionMode: websocket.CompressionContextTakeover,
	})
	if err != nil {
		return fmt.Errorf("dial %s: %w", wsURL, err)
	}
	conn.SetReadLimit(wsReadLimit)
	defer conn.CloseNow()

	// ── Handshake ────────────────────────────────────────────────────────────
	hCtx, hCancel := context.WithTimeout(ctx, wsHandshakeTimeout)
	defer hCancel()

	err = wsjson.Write(hCtx, conn, Message{
		Type:         "register",
		AgentID:      c.agentID,
		APIKey:       c.apiKey,
		Capabilities: c.handlers.Names(),
	})
	if err != nil {
		return fmt.Errorf("handshake send: %w", err)
	}

	var welcome Message
	if err := wsjson.Read(hCtx, conn, &welcome); err != nil {
		// CloseStatus returns the WS close code, or -1 if it's not a close error.
		code := websocket.CloseStatus(err)
		// Any 4xxx close code is an application-level rejection (4003 = unauthorized).
		// We check the whole range because a proxy (e.g. nginx) may forward the
		// backend's 4003 as a different 4xxx code instead of exactly 4003.
		if code >= 4000 {
			return ErrUnauthorized
		}
		// Server closed the connection without a 4xxx code (code == -1 means the
		// error is not a WS close frame — e.g. nginx dropped the TCP connection
		// after stripping the close code). Signal this separately so RunForever
		// can count consecutive occurrences and trigger re-registration.
		return fmt.Errorf("handshake recv (close=%d): %w", code, ErrHandshakeClose)
	}
	if welcome.Type != "welcome" {
		return fmt.Errorf("unexpected handshake response: %s", welcome.Type)
	}
	log.Printf("[ws] connected to backend (agent_id=%s)", c.agentID)

	// ── Main loop ─────────────────────────────────────────────────────────────
	pingTicker := time.NewTicker(wsPingInterval)
	defer pingTicker.Stop()

	msgCh := make(chan Message, 16)
	errCh := make(chan error, 1)

	// Reader goroutine
	go func() {
		for {
			var msg Message
			if err := wsjson.Read(ctx, conn, &msg); err != nil {
				errCh <- err
				return
			}
			msgCh <- msg
		}
	}()

	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "shutdown")
			return nil

		case err := <-errCh:
			return err

		case <-pingTicker.C:
			// ── WS protocol-level ping ─────────────────────────────────────
			// conn.Ping() sends a WebSocket PING frame (opcode 0x9) and waits
			// for the peer's PONG. This runs at the transport layer — if the
			// TCP connection has died silently (NAT expiry, firewall drop with
			// no FIN), Ping() will fail within wsPingTimeout and we reconnect
			// immediately instead of blocking until the OS TCP timeout fires.
			pCtx, pCancel := context.WithTimeout(ctx, wsPingTimeout)
			pingErr := conn.Ping(pCtx)
			pCancel()
			if pingErr != nil {
				return fmt.Errorf("keepalive ping failed: %w", pingErr)
			}

			// Push metrics after confirming the connection is alive.
			if c.metricsFn != nil {
				if metrics, err := c.metricsFn(); err == nil {
					raw, _ := json.Marshal(metrics)
					_ = wsjson.Write(ctx, conn, Message{
						Type:    "metric",
						AgentID: c.agentID,
						Metrics: raw,
					})
				}
			}

		case msg := <-msgCh:
			switch msg.Type {
			case "fetch":
				go c.handleFetch(ctx, conn, msg)
			case "pong":
				// heartbeat ack — no action needed
			case "new_key":
				// Server rotated this agent's API key.
				// Update in-memory key so the next handshake uses the new one.
				if msg.APIKey != "" {
					c.apiKey = msg.APIKey
					if c.onKeyRotate != nil {
						c.onKeyRotate(msg.APIKey)
					}
					log.Printf("[ws] API key rotated by server — in-memory and disk updated")
				}
			}
		}
	}
}

func (c *WSClient) handleFetch(ctx context.Context, conn *websocket.Conn, msg Message) {
	handler, ok := c.handlers.Get(msg.Capability)
	if !ok {
		_ = wsjson.Write(ctx, conn, Message{
			Type:      "response",
			RequestID: msg.RequestID,
			Error:     fmt.Sprintf("capability %q not supported", msg.Capability),
		})
		return
	}

	result, err := handler(ctx, msg.Params)
	resp := Message{Type: "response", RequestID: msg.RequestID}
	if err != nil {
		resp.Error = err.Error()
	} else {
		if raw, merr := json.Marshal(result); merr == nil {
			resp.Data = raw
		} else {
			resp.Error = merr.Error()
		}
	}
	_ = wsjson.Write(ctx, conn, resp)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func toWSURL(httpURL string) string {
	if len(httpURL) >= 5 && httpURL[:5] == "https" {
		return "wss" + httpURL[5:]
	}
	if len(httpURL) >= 4 && httpURL[:4] == "http" {
		return "ws" + httpURL[4:]
	}
	return httpURL
}

func min(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
