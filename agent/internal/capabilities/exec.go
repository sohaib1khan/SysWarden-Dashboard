package capabilities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/syswarden/agent/internal/audit"
	"github.com/syswarden/agent/internal/config"
)

// ExecCommand runs an allowlisted shell command and returns stdout/stderr.
// params: { "command": "df -h", "timeout_seconds": 10 }
// Security: command must be in the agent's allowlist. Always audited.
func ExecCommand(agentID string, allowlist *config.AllowedCommands) func(context.Context, json.RawMessage) (interface{}, error) {
	return func(ctx context.Context, params json.RawMessage) (interface{}, error) {
		var p struct {
			Command        string `json:"command"`
			TimeoutSeconds int    `json:"timeout_seconds"`
		}
		p.TimeoutSeconds = 10
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		if p.TimeoutSeconds <= 0 || p.TimeoutSeconds > 60 {
			p.TimeoutSeconds = 10
		}

		allowed := allowlist.IsAllowed(p.Command)
		audit.Log(agentID, "sys.exec", p.Command, allowed)

		if !allowed {
			return nil, fmt.Errorf("command %q is not in the exec allowlist", p.Command)
		}

		cmdCtx, cancel := context.WithTimeout(ctx, time.Duration(p.TimeoutSeconds)*time.Second)
		defer cancel()

		// Use sh -c so the allowlisted string (e.g. "df -h") runs as intended,
		// but the full string must match the allowlist — no shell injection is
		// possible because we check the entire command string before passing it.
		cmd := exec.CommandContext(cmdCtx, "sh", "-c", p.Command)

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		err := cmd.Run()
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				return nil, fmt.Errorf("exec error: %w", err)
			}
		}

		return map[string]interface{}{
			"command":   p.Command,
			"stdout":    stdout.String(),
			"stderr":    stderr.String(),
			"exit_code": exitCode,
		}, nil
	}
}
