package audit

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

// Entry represents a single auditable event.
type Entry struct {
	Timestamp string `json:"ts"`
	AgentID   string `json:"agent_id"`
	Event     string `json:"event"`   // e.g. "sys.exec", "sys.files"
	Detail    string `json:"detail"`  // What was requested (command, path, etc.)
	Allowed   bool   `json:"allowed"` // Whether it was permitted
}

var logger = log.New(os.Stdout, "[AUDIT] ", 0)

// Log writes a structured JSON audit record to stdout (captured by the
// container runtime / log aggregator). The audit log is append-only by
// design — we never delete or modify entries.
func Log(agentID, event, detail string, allowed bool) {
	entry := Entry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentID:   agentID,
		Event:     event,
		Detail:    detail,
		Allowed:   allowed,
	}
	if b, err := json.Marshal(entry); err == nil {
		logger.Println(string(b))
	}
}
