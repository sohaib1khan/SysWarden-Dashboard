package capabilities

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"time"
)

// CheckNetwork tests TCP connectivity to a list of host:port targets.
// params: { "targets": ["google.com:443", "192.168.1.1:22"], "timeout_seconds": 5 }
func CheckNetwork(_ context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Targets        []string `json:"targets"`
		TimeoutSeconds int      `json:"timeout_seconds"`
	}
	p.TimeoutSeconds = 5
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if len(p.Targets) == 0 {
		return nil, fmt.Errorf("targets must not be empty")
	}
	if len(p.Targets) > 20 {
		p.Targets = p.Targets[:20]
	}
	if p.TimeoutSeconds <= 0 || p.TimeoutSeconds > 30 {
		p.TimeoutSeconds = 5
	}

	timeout := time.Duration(p.TimeoutSeconds) * time.Second
	type result struct {
		Target  string  `json:"target"`
		Reachable bool  `json:"reachable"`
		LatencyMs float64 `json:"latency_ms,omitempty"`
		Error   string  `json:"error,omitempty"`
	}

	var results []result
	for _, target := range p.Targets {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", target, timeout)
		elapsed := time.Since(start).Seconds() * 1000

		if err != nil {
			results = append(results, result{Target: target, Reachable: false, Error: err.Error()})
		} else {
			conn.Close()
			results = append(results, result{Target: target, Reachable: true, LatencyMs: round2(elapsed)})
		}
	}
	return results, nil
}
