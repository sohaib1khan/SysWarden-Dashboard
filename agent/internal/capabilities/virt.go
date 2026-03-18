package capabilities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// ── Availability ──────────────────────────────────────────────────────────────

// VirtAvailable returns true if any supported hypervisor CLI is present.
// Checks: pvesh (Proxmox VE), virsh (libvirt/KVM/QEMU), VBoxManage (VirtualBox).
func VirtAvailable() bool {
	return pveshAvailable() || virshAvailable() || vboxAvailable()
}

func pveshAvailable() bool {
	_, err := exec.LookPath("pvesh")
	return err == nil
}

func virshAvailable() bool {
	if _, err := exec.LookPath("virsh"); err != nil {
		return false
	}
	return exec.Command("virsh", "--version").Run() == nil
}

func vboxAvailable() bool {
	if _, err := exec.LookPath("VBoxManage"); err != nil {
		return false
	}
	return exec.Command("VBoxManage", "--version").Run() == nil
}

// PodmanAvailable returns true if podman is present and responsive.
func PodmanAvailable() bool {
	if _, err := exec.LookPath("podman"); err != nil {
		return false
	}
	return exec.Command("podman", "info", "--format", "{{.Host.Hostname}}").Run() == nil
}

// ── VM struct ─────────────────────────────────────────────────────────────────

// VM is a normalised virtual-machine record across all supported hypervisors.
type VM struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	State      string  `json:"state"`
	Hypervisor string  `json:"hypervisor"`          // "proxmox-qemu", "proxmox-lxc", "kvm", "virtualbox"
	Node       string  `json:"node,omitempty"`      // Proxmox: node name
	VMID       int     `json:"vmid,omitempty"`      // Proxmox: numeric VMID
	CPUPct     float64 `json:"cpu_pct,omitempty"`   // 0–100
	MemMB      float64 `json:"mem_mb,omitempty"`    // used RAM
	MaxMemMB   float64 `json:"maxmem_mb,omitempty"` // configured RAM
	UptimeSec  int     `json:"uptime_sec,omitempty"`
}

// ListVMs collects VMs from all available hypervisors.
// Priority: Proxmox (pvesh) → libvirt (virsh).
// VirtualBox is always checked independently since it can coexist with either.
func ListVMs(_ context.Context, _ json.RawMessage) (interface{}, error) {
	var vms []VM

	if pveshAvailable() {
		if pve, err := listPveshVMs(); err == nil {
			vms = append(vms, pve...)
		}
	} else if virshAvailable() {
		if kvm, err := listVirshVMs(); err == nil {
			vms = append(vms, kvm...)
		}
	}

	if vboxAvailable() {
		if vbox, err := listVBoxVMs(); err == nil {
			vms = append(vms, vbox...)
		}
	}

	if vms == nil {
		vms = []VM{}
	}
	return vms, nil
}

// ── Proxmox VE (pvesh) ────────────────────────────────────────────────────────

func listPveshVMs() ([]VM, error) {
	nodesOut, err := runCmd("pvesh", "get", "/nodes", "--output-format", "json")
	if err != nil {
		return nil, fmt.Errorf("pvesh /nodes: %w", err)
	}

	var nodes []struct {
		Node string `json:"node"`
	}
	if err := json.Unmarshal([]byte(nodesOut), &nodes); err != nil {
		return nil, fmt.Errorf("pvesh nodes parse: %w", err)
	}

	var vms []VM
	for _, n := range nodes {
		// QEMU virtual machines
		qemuOut, err := runCmd("pvesh", "get", "/nodes/"+n.Node+"/qemu", "--output-format", "json")
		if err == nil {
			var qemus []struct {
				VMID   int     `json:"vmid"`
				Name   string  `json:"name"`
				Status string  `json:"status"`
				CPU    float64 `json:"cpu"`
				Mem    int64   `json:"mem"`
				MaxMem int64   `json:"maxmem"`
				Uptime int     `json:"uptime"`
			}
			if json.Unmarshal([]byte(qemuOut), &qemus) == nil {
				for _, q := range qemus {
					name := q.Name
					if name == "" {
						name = fmt.Sprintf("vm-%d", q.VMID)
					}
					vms = append(vms, VM{
						ID:         fmt.Sprintf("%d", q.VMID),
						Name:       name,
						State:      q.Status,
						Hypervisor: "proxmox-qemu",
						Node:       n.Node,
						VMID:       q.VMID,
						CPUPct:     round2(q.CPU * 100),
						MemMB:      round2(float64(q.Mem) / 1024 / 1024),
						MaxMemMB:   round2(float64(q.MaxMem) / 1024 / 1024),
						UptimeSec:  q.Uptime,
					})
				}
			}
		}

		// LXC containers
		lxcOut, err := runCmd("pvesh", "get", "/nodes/"+n.Node+"/lxc", "--output-format", "json")
		if err == nil {
			var lxcs []struct {
				VMID   int     `json:"vmid"`
				Name   string  `json:"name"`
				Status string  `json:"status"`
				CPU    float64 `json:"cpu"`
				Mem    int64   `json:"mem"`
				MaxMem int64   `json:"maxmem"`
				Uptime int     `json:"uptime"`
			}
			if json.Unmarshal([]byte(lxcOut), &lxcs) == nil {
				for _, c := range lxcs {
					name := c.Name
					if name == "" {
						name = fmt.Sprintf("ct-%d", c.VMID)
					}
					vms = append(vms, VM{
						ID:         fmt.Sprintf("%d", c.VMID),
						Name:       name,
						State:      c.Status,
						Hypervisor: "proxmox-lxc",
						Node:       n.Node,
						VMID:       c.VMID,
						CPUPct:     round2(c.CPU * 100),
						MemMB:      round2(float64(c.Mem) / 1024 / 1024),
						MaxMemMB:   round2(float64(c.MaxMem) / 1024 / 1024),
						UptimeSec:  c.Uptime,
					})
				}
			}
		}
	}
	return vms, nil
}

// ── libvirt / KVM (virsh) ────────────────────────────────────────────────────

func listVirshVMs() ([]VM, error) {
	out, err := runVirsh("list", "--all", "--name")
	if err != nil {
		return nil, fmt.Errorf("virsh list: %w", err)
	}

	var vms []VM
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		stateOut, _ := runVirsh("domstate", name)
		state := strings.TrimSpace(stateOut)
		if state == "" {
			state = "unknown"
		}
		vms = append(vms, VM{
			Name:       name,
			State:      state,
			Hypervisor: "kvm",
		})
	}
	return vms, nil
}

// ── VirtualBox (VBoxManage) ───────────────────────────────────────────────────

func listVBoxVMs() ([]VM, error) {
	// "list vms" gives NAME {UUID} lines for all VMs (registered)
	out, err := runCmd("VBoxManage", "list", "vms")
	if err != nil {
		return nil, fmt.Errorf("VBoxManage list vms: %w", err)
	}

	// "list runningvms" gives the same format for only the running ones
	runningOut, _ := runCmd("VBoxManage", "list", "runningvms")
	runningNames := map[string]bool{}
	for _, line := range strings.Split(runningOut, "\n") {
		if name := vboxParseName(line); name != "" {
			runningNames[name] = true
		}
	}

	var vms []VM
	for _, line := range strings.Split(out, "\n") {
		name := vboxParseName(line)
		if name == "" {
			continue
		}
		state := "powered off"
		if runningNames[name] {
			state = "running"
		}
		vms = append(vms, VM{
			Name:       name,
			State:      state,
			Hypervisor: "virtualbox",
		})
	}
	return vms, nil
}

// vboxParseName extracts the VM name from a VBoxManage list line: "Name" {uuid}
func vboxParseName(line string) string {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "\"") {
		return ""
	}
	rest := line[1:]
	end := strings.Index(rest, "\"")
	if end < 0 {
		return ""
	}
	return rest[:end]
}

// ── Podman containers ─────────────────────────────────────────────────────────

// PodmanContainer is a summarised Podman container record.
type PodmanContainer struct {
	ID      string `json:"id"`
	Names   string `json:"names"`
	Image   string `json:"image"`
	State   string `json:"state"`
	Created string `json:"created"`
	Ports   string `json:"ports"`
}

// ListPodmanContainers returns all Podman containers (running + stopped).
func ListPodmanContainers(_ context.Context, _ json.RawMessage) (interface{}, error) {
	out, err := runPodman("ps", "-a", "--format", "json")
	if err != nil {
		return nil, fmt.Errorf("podman ps: %w", err)
	}

	// Podman ps --format json emits an array of objects.
	var raw []struct {
		ID      string   `json:"Id"`
		Names   []string `json:"Names"`
		Image   string   `json:"Image"`
		State   string   `json:"State"`
		Created string   `json:"Created"`
		Ports   []struct {
			HostPort      int    `json:"host_port"`
			ContainerPort int    `json:"container_port"`
			Protocol      string `json:"protocol"`
		} `json:"Ports"`
	}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("parse podman JSON: %w", err)
	}

	containers := make([]PodmanContainer, 0, len(raw))
	for _, r := range raw {
		id := r.ID
		if len(id) > 12 {
			id = id[:12]
		}
		names := strings.Join(r.Names, ", ")

		var ports []string
		for _, p := range r.Ports {
			ports = append(ports, fmt.Sprintf("%d:%d/%s", p.HostPort, p.ContainerPort, p.Protocol))
		}
		containers = append(containers, PodmanContainer{
			ID:      id,
			Names:   names,
			Image:   r.Image,
			State:   r.State,
			Created: r.Created,
			Ports:   strings.Join(ports, ", "),
		})
	}
	return containers, nil
}

// ── Internal helpers ──────────────────────────────────────────────────────────

func runCmd(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...) // #nosec G204 — controlled tool invocations
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s %s: %s", name, strings.Join(args, " "), stderr.String())
	}
	return stdout.String(), nil
}

func runVirsh(args ...string) (string, error) {
	return runCmd("virsh", args...)
}

func runPodman(args ...string) (string, error) {
	return runCmd("podman", args...)
}

