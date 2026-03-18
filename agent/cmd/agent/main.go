package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/syswarden/agent/internal/capabilities"
	"github.com/syswarden/agent/internal/config"
	"github.com/syswarden/agent/internal/plugins"
	"github.com/syswarden/agent/internal/relay"
)

func main() {
	// CLI flags — take priority over env vars
	var flagBackend string
	var flagInstall, flagUninstall bool
	flag.StringVar(&flagBackend, "backend", "", "SysWarden backend URL (e.g. http://192.168.1.10:8000)")
	flag.StringVar(&flagBackend, "b", "", "SysWarden backend URL (shorthand)")
	flag.BoolVar(&flagInstall, "install", false, "Install as a systemd service and exit")
	flag.BoolVar(&flagUninstall, "uninstall", false, "Remove the systemd service and exit")
	flag.Parse()

	if flagInstall {
		installService()
		return
	}
	if flagUninstall {
		uninstallService()
		return
	}

	// Let --backend / -b override the env var
	if flagBackend != "" {
		os.Setenv("SYSWARDEN_BACKEND_URL", strings.TrimRight(flagBackend, "/"))
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[agent] config error: %v", err)
	}

	// ── Allowlist (used by sys.exec) ───────────────────────────────────────────
	allowlist := &config.AllowedCommands{}
	// Load from config file if present in future — for now starts empty (exec disabled)

	// ── Build handler registry — probe host capabilities and register handlers ──
	registry := relay.NewHandlerRegistry()
	registry.Set("sys.metrics", func(_ context.Context, _ json.RawMessage) (interface{}, error) {
		return capabilities.CollectSystemMetrics()
	})
	registry.Set("sys.processes", capabilities.CollectProcesses)
	registry.Set("sys.logs", capabilities.TailLog)
	registry.Set("sys.files", capabilities.ReadFile)
	registry.Set("sys.network", capabilities.CheckNetwork)
	registry.Set("sys.exec", capabilities.ExecCommand(cfg.AgentID, allowlist))
	if capabilities.DockerAvailable() {
		registry.Set("docker.list", capabilities.ListDockerContainers)
		registry.Set("docker.logs", capabilities.DockerContainerLogs)
		log.Println("[agent] Docker detected — docker.list and docker.logs enabled")
	}
	if capabilities.K8sAvailable() {
		registry.Set("k8s.pods", capabilities.ListK8sPods)
		registry.Set("k8s.nodes", capabilities.ListK8sNodes)
		log.Println("[agent] Kubernetes detected — k8s.pods and k8s.nodes enabled")
	}
	if capabilities.VirtAvailable() {
		registry.Set("virt.vms", capabilities.ListVMs)
		log.Println("[agent] hypervisor detected (pvesh/virsh/VBoxManage) — virt.vms enabled")
	}
	if capabilities.PodmanAvailable() {
		registry.Set("podman.list", capabilities.ListPodmanContainers)
		log.Println("[agent] Podman detected — podman.list enabled")
	}

	// ── Register if no credentials yet ────────────────────────────────────────
	if cfg.AgentID == "" || cfg.APIKey == "" {
		hostname, err := os.Hostname()
		if err != nil {
			hostname = "unknown"
		}

		tmp := relay.NewClient(cfg.BackendURL, "", "")
		regResp, err := tmp.Register(context.Background(), relay.RegisterRequest{
			Hostname:     hostname,
			Capabilities: registry.Names(),
		})
		if err != nil {
			if strings.Contains(cfg.BackendURL, "localhost") || strings.Contains(cfg.BackendURL, "127.0.0.1") {
				log.Fatalf(
					"[agent] registration failed: %v\n\n"+
						"  Hint: you are running on a remote machine but the backend URL is set to %q.\n"+
						"  Pass the backend address explicitly:\n\n"+
						"    ./agent-linux-amd64 --backend http://<server-ip>:8000\n\n"+
						"  Or set the environment variable:\n\n"+
						"    SYSWARDEN_BACKEND_URL=http://<server-ip>:8000 ./agent-linux-amd64\n",
					err, cfg.BackendURL,
				)
			}
			log.Fatalf("[agent] registration failed: %v", err)
		}

		cfg.AgentID = regResp.AgentID
		cfg.APIKey = regResp.APIKey

		if err := config.PersistCredentials(cfg.KeyFile, cfg.AgentID, cfg.APIKey); err != nil {
			log.Printf("[agent] WARNING: could not persist key file: %v", err)
		}

		fmt.Printf("\n✅ Agent registered!\n   ID  : %s\n   Key : %s\n   (Saved to %s)\n\n",
			cfg.AgentID, cfg.APIKey, cfg.KeyFile)
	} else {
		log.Printf("[agent] starting with existing credentials (id=%s)", cfg.AgentID)
	}

	// ── Metrics push function (called every WS ping interval) ─────────────────
	metricsFn := func() (interface{}, error) {
		return capabilities.CollectSystemMetrics()
	}

	// ── Plugin loader (Phase 5+6) ──────────────────────────────────────────────
	httpClient := relay.NewClient(cfg.BackendURL, cfg.AgentID, cfg.APIKey)
	pluginLoader := plugins.New(cfg.PluginsDir, cfg.AgentID, httpClient, registry)

	// ── WS client — runs forever with reconnect ────────────────────────────────
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go pluginLoader.Run(ctx)

	// reauth is invoked by the WS client when the backend rejects credentials
	// with close code 4003. It clears the stale keyfile, calls register (which
	// upserts by hostname returning the same agent_id), persists new credentials,
	// and returns the new agentID + apiKey so the WS client can reconnect immediately.
	reauth := func() (string, string, error) {
		hostname, _ := os.Hostname()
		log.Printf("[agent] stale/revoked credentials — re-registering as %q", hostname)
		_ = os.Remove(cfg.KeyFile)
		tmp := relay.NewClient(cfg.BackendURL, "", "")
		regResp, err := tmp.Register(context.Background(), relay.RegisterRequest{
			Hostname:     hostname,
			Capabilities: registry.Names(),
		})
		if err != nil {
			return "", "", fmt.Errorf("re-register: %w", err)
		}
		cfg.AgentID = regResp.AgentID
		cfg.APIKey = regResp.APIKey
		if perr := config.PersistCredentials(cfg.KeyFile, cfg.AgentID, cfg.APIKey); perr != nil {
			log.Printf("[agent] WARNING: could not persist re-registration credentials: %v", perr)
		} else {
			log.Printf("[agent] re-registration complete (id=%s) — restarting to load fresh credentials", cfg.AgentID)
			// Re-exec ourselves in-place so all goroutines (WS client, plugin
			// loader) start fresh with the new keyfile. Unlike os.Exit, this
			// works without any external supervisor (Docker / systemd).
			if exe, eerr := os.Executable(); eerr == nil {
				_ = syscall.Exec(exe, os.Args, os.Environ())
			}
			// syscall.Exec only returns on error — fall through and let the
			// WS client continue with the fresh in-memory credentials.
			log.Printf("[agent] re-exec failed — continuing with updated in-memory credentials")
		}
		return cfg.AgentID, cfg.APIKey, nil
	}

	wsClient := relay.NewWSClient(
		cfg.BackendURL,
		cfg.AgentID,
		cfg.APIKey,
		cfg.KeyFile,
		registry,
		metricsFn,
		func(newKey string) {
			// Server rotated the key — persist it so the next restart uses the new one
			cfg.APIKey = newKey
			if err := config.PersistCredentials(cfg.KeyFile, cfg.AgentID, newKey); err != nil {
				log.Printf("[agent] warning: could not persist rotated key: %v", err)
			} else {
				log.Printf("[agent] rotated API key persisted to %s", cfg.KeyFile)
			}
		},
		reauth,
	)

	log.Printf("[agent] connecting to backend at %s", cfg.BackendURL)
	wsClient.RunForever(ctx)
	log.Println("[agent] shut down")
}

// ── Systemd service install / uninstall ───────────────────────────────────────

func installService() {
	exe, err := os.Executable()
	if err != nil {
		log.Fatalf("[install] cannot determine executable path: %v", err)
	}
	exe, _ = filepath.Abs(exe)

	// Build ExecStart: pass --backend if it was given, skip --install/--uninstall.
	var args []string
	skip := map[string]bool{"--install": true, "-install": true, "--uninstall": true, "-uninstall": true}
	for _, a := range os.Args[1:] {
		if !skip[a] {
			args = append(args, a)
		}
	}
	execStart := exe
	if len(args) > 0 {
		execStart = exe + " " + strings.Join(args, " ")
	}

	unit := fmt.Sprintf(`[Unit]
Description=SysWarden Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`, execStart)

	// System-wide if root, user-level otherwise.
	var serviceFile string
	if os.Getuid() == 0 {
		serviceFile = "/etc/systemd/system/syswarden-agent.service"
	} else {
		home, _ := os.UserHomeDir()
		dir := filepath.Join(home, ".config", "systemd", "user")
		if err := os.MkdirAll(dir, 0700); err != nil {
			log.Fatalf("[install] cannot create user systemd dir: %v", err)
		}
		serviceFile = filepath.Join(dir, "syswarden-agent.service")
	}

	if err := os.WriteFile(serviceFile, []byte(unit), 0644); err != nil {
		log.Fatalf("[install] cannot write service file %s: %v\n  Try running with sudo for system-wide install.", serviceFile, err)
	}
	fmt.Printf("✅ Service file written: %s\n", serviceFile)

	systemctl := "systemctl"
	if os.Getuid() != 0 {
		systemctl = "systemctl --user"
	}
	for _, args := range []string{"daemon-reload", "enable syswarden-agent", "start syswarden-agent"} {
		parts := strings.Fields(systemctl + " " + args)
		out, err := exec.Command(parts[0], parts[1:]...).CombinedOutput()
		if err != nil {
			log.Printf("[install] %s %s: %v\n%s", systemctl, args, err, strings.TrimSpace(string(out)))
		}
	}

	if os.Getuid() != 0 {
		fmt.Println("\n⚠  User service: the agent will only run while you are logged in.")
		fmt.Println("   To keep it running after logout:  loginctl enable-linger $USER")
	}
	fmt.Println("\n✅ Agent installed and started.")
	fmt.Printf("   View logs:  journalctl -fu syswarden-agent\n")
	fmt.Printf("   Stop:       %s stop syswarden-agent\n", systemctl)
	fmt.Printf("   Remove:     %s --uninstall  (then re-run to confirm)\n", exe)
}

func uninstallService() {
	systemctl := "systemctl"
	var serviceFile string
	if os.Getuid() == 0 {
		serviceFile = "/etc/systemd/system/syswarden-agent.service"
	} else {
		systemctl = "systemctl --user"
		home, _ := os.UserHomeDir()
		serviceFile = filepath.Join(home, ".config", "systemd", "user", "syswarden-agent.service")
	}
	for _, args := range []string{"stop syswarden-agent", "disable syswarden-agent"} {
		parts := strings.Fields(systemctl + " " + args)
		exec.Command(parts[0], parts[1:]...).Run() // best-effort
	}
	if err := os.Remove(serviceFile); err != nil && !os.IsNotExist(err) {
		log.Fatalf("[uninstall] cannot remove %s: %v", serviceFile, err)
	}
	exec.Command(strings.Fields(systemctl+" daemon-reload")[0], strings.Fields(systemctl+" daemon-reload")[1:]...).Run()
	fmt.Printf("✅ Service removed: %s\n", serviceFile)
}
