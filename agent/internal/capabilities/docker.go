package capabilities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// DockerContainer represents a summarised container record.
type DockerContainer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	Status  string `json:"status"`
	State   string `json:"state"`
}

// DockerAvailable returns true if docker is present and the daemon is running.
func DockerAvailable() bool {
	if _, err := exec.LookPath("docker"); err != nil {
		return false
	}
	return exec.Command("docker", "info", "--format", "{{.ID}}").Run() == nil
}

// ListDockerContainers returns all containers (running + stopped).
// Requires Docker to be present on the host.
func ListDockerContainers(_ context.Context, _ json.RawMessage) (interface{}, error) {
	out, err := runDocker("ps", "-a", "--format",
		`{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}}"}`)
	if err != nil {
		return nil, err
	}

	var containers []DockerContainer
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		// Fix the trailing `}"` artifact from the format string
		line = strings.TrimSuffix(line, `"}`) + `"}`
		var c DockerContainer
		if err := json.Unmarshal([]byte(line), &c); err == nil {
			containers = append(containers, c)
		}
	}
	return containers, nil
}

// DockerContainerLogs returns the last N lines of a container's logs.
// params: { "container": "my-app", "lines": 50 }
func DockerContainerLogs(_ context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Container string `json:"container"`
		Lines     int    `json:"lines"`
	}
	p.Lines = 50
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}
	if p.Container == "" {
		return nil, fmt.Errorf("container name is required")
	}
	// Sanitise: only allow safe container name characters
	for _, c := range p.Container {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
			return nil, fmt.Errorf("invalid container name")
		}
	}
	if p.Lines <= 0 || p.Lines > 1000 {
		p.Lines = 50
	}

	out, err := runDocker("logs", "--tail", fmt.Sprintf("%d", p.Lines), p.Container)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"container": p.Container,
		"logs":      out,
	}, nil
}

func runDocker(args ...string) (string, error) {
	cmd := exec.Command("docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("docker %s: %s", strings.Join(args, " "), stderr.String())
	}
	return stdout.String(), nil
}
