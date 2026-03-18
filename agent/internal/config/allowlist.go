package config

// Allowlist holds the set of commands the agent is permitted to execute
// via the sys.exec capability. Loaded from agent.yaml (Phase 2).
// For Phase 1 this is unused; the file exists to hold the struct
// so the rest of the codebase can import it without changes later.

// AllowedCommands is the parsed allowlist. An empty set means
// sys.exec is fully disabled (safe default).
type AllowedCommands struct {
	Commands []string `yaml:"exec_allowlist"`
}

// IsAllowed returns true only if cmd is explicitly listed.
func (a *AllowedCommands) IsAllowed(cmd string) bool {
	for _, c := range a.Commands {
		if c == cmd {
			return true
		}
	}
	return false
}
