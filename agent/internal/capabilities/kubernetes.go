package capabilities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

// K8sPod is a summarised pod record.
type K8sPod struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Ready     string `json:"ready"`    // e.g. "2/2"
	Status    string `json:"status"`   // Running, Pending, CrashLoopBackOff…
	Restarts  int    `json:"restarts"` // total restart count across all containers
	NodeName  string `json:"node"`
}

// K8sNode is a summarised node record.
type K8sNode struct {
	Name    string `json:"name"`
	Status  string `json:"status"`  // Ready | NotReady | Unknown
	Roles   string `json:"roles"`   // control-plane, worker, …
	Version string `json:"version"` // kubelet version
}

// ── Availability ──────────────────────────────────────────────────────────────

// K8sAvailable returns true if kubectl is in PATH and can reach a cluster.
// Uses a short timeout to avoid blocking agent startup.
func K8sAvailable() bool {
	if _, err := exec.LookPath("kubectl"); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "kubectl", "cluster-info", "--request-timeout=3s")
	return cmd.Run() == nil
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// ListK8sPods returns all pods across all namespaces.
func ListK8sPods(_ context.Context, _ json.RawMessage) (interface{}, error) {
	out, err := runKubectl("get", "pods", "-A", "-o", "json", "--request-timeout=10s")
	if err != nil {
		return nil, fmt.Errorf("kubectl get pods: %w", err)
	}

	var raw struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				NodeName string `json:"nodeName"`
			} `json:"spec"`
			Status struct {
				Phase             string `json:"phase"`
				ContainerStatuses []struct {
					Ready        bool `json:"ready"`
					RestartCount int  `json:"restartCount"`
					State        struct {
						Waiting *struct {
							Reason string `json:"reason"`
						} `json:"waiting"`
					} `json:"state"`
				} `json:"containerStatuses"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("parse pods JSON: %w", err)
	}

	pods := make([]K8sPod, 0, len(raw.Items))
	for _, item := range raw.Items {
		phase := item.Status.Phase
		if phase == "" {
			phase = "Unknown"
		}
		restarts := 0
		readyCount := 0
		total := len(item.Status.ContainerStatuses)
		for _, cs := range item.Status.ContainerStatuses {
			restarts += cs.RestartCount
			if cs.Ready {
				readyCount++
			}
			// CrashLoopBackOff / ImagePullBackOff override the phase label
			if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
				phase = cs.State.Waiting.Reason
			}
		}
		ready := fmt.Sprintf("%d/%d", readyCount, total)
		if total == 0 {
			ready = "—"
		}
		pods = append(pods, K8sPod{
			Namespace: item.Metadata.Namespace,
			Name:      item.Metadata.Name,
			Ready:     ready,
			Status:    phase,
			Restarts:  restarts,
			NodeName:  item.Spec.NodeName,
		})
	}
	return pods, nil
}

// ListK8sNodes returns all cluster nodes with status and role labels.
func ListK8sNodes(_ context.Context, _ json.RawMessage) (interface{}, error) {
	out, err := runKubectl("get", "nodes", "-o", "json", "--request-timeout=10s")
	if err != nil {
		return nil, fmt.Errorf("kubectl get nodes: %w", err)
	}

	var raw struct {
		Items []struct {
			Metadata struct {
				Name   string            `json:"name"`
				Labels map[string]string `json:"labels"`
			} `json:"metadata"`
			Status struct {
				Conditions []struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				} `json:"conditions"`
				NodeInfo struct {
					KubeletVersion string `json:"kubeletVersion"`
				} `json:"nodeInfo"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("parse nodes JSON: %w", err)
	}

	nodes := make([]K8sNode, 0, len(raw.Items))
	for _, item := range raw.Items {
		// Determine ready status from conditions
		status := "Unknown"
		for _, cond := range item.Status.Conditions {
			if cond.Type == "Ready" {
				if cond.Status == "True" {
					status = "Ready"
				} else {
					status = "NotReady"
				}
			}
		}

		// Collect roles from label keys like node-role.kubernetes.io/<role>
		var roles []string
		for k := range item.Metadata.Labels {
			const prefix = "node-role.kubernetes.io/"
			if strings.HasPrefix(k, prefix) {
				role := strings.TrimPrefix(k, prefix)
				if role != "" {
					roles = append(roles, role)
				}
			}
		}
		rolesStr := strings.Join(roles, ",")
		if rolesStr == "" {
			rolesStr = "worker"
		}

		nodes = append(nodes, K8sNode{
			Name:    item.Metadata.Name,
			Status:  status,
			Roles:   rolesStr,
			Version: item.Status.NodeInfo.KubeletVersion,
		})
	}
	return nodes, nil
}

// ── Internal helpers ──────────────────────────────────────────────────────────

func runKubectl(args ...string) (string, error) {
	cmd := exec.Command("kubectl", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("kubectl %s: %s", strings.Join(args, " "), stderr.String())
	}
	return stdout.String(), nil
}
