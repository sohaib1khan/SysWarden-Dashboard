/**
 * 🧭 SiteNavigator — content configuration
 *
 * Each entry maps a route (or route prefix) to a page guide.
 * Structure:
 *   {
 *     route:    string | RegExp   – matched against location.pathname
 *     title:    string            – page name shown in the header
 *     icon:     string            – emoji icon
 *     summary:  string            – one-liner purpose of the page
 *     sections: [{ heading, body, tip? }]
 *   }
 */

export const NAVIGATOR_PAGES = [
  // ── Overview ────────────────────────────────────────────────────────────────
  {
    route: '/overview',
    title: 'Overview',
    icon: '🗺',
    summary: 'Live dashboard showing all connected agents and their health at a glance.',
    sections: [
      {
        heading: 'Agent cards',
        body: 'Each card represents a registered agent. The coloured dot shows online/offline status. Click any card to drill into that agent\'s detailed metrics.',
      },
      {
        heading: 'Metric sparklines',
        body: 'CPU, RAM, and disk sparklines are shown inline on each card so you can spot trends without opening the detail view.',
        tip: 'Hover a sparkline bar to see the exact value and timestamp.',
      },
      {
        heading: 'Status banner',
        body: 'The top banner switches between "All Systems Operational" (green) and "Degraded Performance" (red) based on whether any agents or monitors are down.',
      },
      {
        heading: 'Auto-refresh',
        body: 'The page refreshes via WebSocket push — data updates in real time as agents report in. No manual refresh needed.',
      },
    ],
  },

  // ── Status Monitors ─────────────────────────────────────────────────────────
  {
    route: '/status',
    title: 'Status Monitors',
    icon: '📡',
    summary: 'HTTP/HTTPS/TCP uptime monitoring — track whether your endpoints are up and responding.',
    sections: [
      {
        heading: 'Adding a monitor',
        body: 'Click "+ Add Monitor". Fill in the name, type (HTTP, Keyword, TCP), and URL or hostname. Hit "Add monitor" to save.',
        tip: 'Use the Group field to organise monitors by environment (PROD, Staging, Local…).',
      },
      {
        heading: 'Monitor types',
        body: '🌐 HTTP — checks that the URL returns a 2xx/3xx status.\n🔍 Keyword — HTTP check plus verifies a word/phrase appears in the response body.\n🔌 TCP — raw connection check for databases, Redis, SMTP, etc.',
      },
      {
        heading: 'Uptime bar',
        body: 'Each card shows the last 60 check results as a colour-coded bar. Green = up, Red = down. Hover any segment for exact time and latency.',
      },
      {
        heading: 'Status filters',
        body: 'Click the Online, Down, or Paused stat cards at the top to instantly filter the view to only those monitors. Click again to clear.',
      },
      {
        heading: 'Group reordering',
        body: 'Drag the ⠿ handle on the left of any group header to rearrange groups. Order is saved locally in your browser.',
        tip: 'You can also drag individual monitor cards between groups.',
      },
      {
        heading: 'Devops metrics strip',
        body: '⚡ Avg response — mean latency of all up monitors.\n📈 P95 latency — 95th-percentile tail latency.\n⏰ Stale checks — monitors not polled within 2× their interval (checker health warning).\n🔄 Check rate — total checks per minute across all enabled monitors.',
      },
      {
        heading: 'Advanced options',
        body: 'Expand "⚙ Advanced options" when editing/adding a monitor to access:\n• Ignore TLS errors — skip cert validation (self-signed certs).\n• Cache buster — appends a random param to bypass CDN caches.\n• Upside-down mode — flips the result; useful to monitor maintenance pages.\n• Cert expiry alert — notify N days before an HTTPS certificate expires.',
        tip: 'Set "Notify if cert expires within" to 14 or 30 days to get ahead of renewals.',
      },
      {
        heading: 'Pause / Resume',
        body: 'Click ⏸ on a card to pause a monitor (stops checks, shows yellow). Click ▶ to resume. Paused monitors still appear in the list but don\'t fire alerts.',
      },
    ],
  },

  // ── Metric Explorer ──────────────────────────────────────────────────────────
  {
    route: '/metrics/explorer',
    title: 'Metric Explorer',
    icon: '📊',
    summary: 'Query and chart historical metrics from any agent over any time window.',
    sections: [
      {
        heading: 'Selecting an agent & metric',
        body: 'Use the Agent dropdown to pick a registered agent, then choose the metric category (CPU, Memory, Disk, Network…). The chart updates automatically.',
      },
      {
        heading: 'Time range',
        body: 'Pick a preset window (1h, 6h, 24h, 7d) or enter a custom range. The chart re-queries the backend when the range changes.',
        tip: 'For large windows the backend returns pre-aggregated data points to keep the chart fast.',
      },
      {
        heading: 'Reading the chart',
        body: 'Hover the chart to see exact values at each timestamp. The dashed threshold line (if set) shows your alert boundary.',
      },
      {
        heading: 'Export',
        body: 'Use the download button to export the visible data as CSV for reporting or further analysis.',
      },
    ],
  },

  // ── Agent Manager ────────────────────────────────────────────────────────────
  {
    route: '/agents/manage',
    title: 'Agent Manager',
    icon: '🖥',
    summary: 'Register, configure, and remove SysWarden agents running on your servers.',
    sections: [
      {
        heading: 'What is an agent?',
        body: 'A lightweight Go binary you install on each server you want to monitor. It streams CPU, RAM, disk, network, and process metrics back to this backend over a persistent WebSocket connection.',
      },
      {
        heading: '📥 Downloading the agent',
        body: 'Click the "📥 Get Agent" button at the top-right of this page. Select your platform (Linux x86-64, ARM64, macOS, Windows) then download the binary and the install script.',
        tip: 'If your platform is shown as "soon", use the Linux x86-64 static build — it runs on any Linux without dynamic library dependencies.',
      },
      {
        heading: '🚀 Quick install (recommended)',
        body: 'After downloading both files, run:\n\n  chmod +x agent-linux-amd64\n  SYSWARDEN_BACKEND_URL=https://your-backend sudo bash install.sh install\n\nThe script creates a systemd service and starts the agent on every boot. The agent appears in this list within seconds.',
        tip: 'Run "sudo bash install.sh status" or "sudo bash install.sh logs" to verify it\'s running.',
      },
      {
        heading: '⚙ Manual / no-systemd run',
        body: 'To run without installing a service:\n\n  SYSWARDEN_BACKEND_URL=https://… SYSWARDEN_API_KEY=… ./agent-linux-amd64\n\nUseful for containers, testing, or systems without systemd.',
      },
      {
        heading: '🔑 API keys',
        body: 'Each agent authenticates with a unique API key. Generate keys in Settings → API Keys. The key is shown only once — copy it immediately. Never commit keys to version control; rotate them if compromised.',
      },
      {
        heading: 'Rename / Remove',
        body: 'Use the Rename button to give an agent a friendly label. Remove deletes the agent record and all its historic metrics — this cannot be undone.',
      },
    ],
  },

  // ── Alert Rules ──────────────────────────────────────────────────────────────
  {
    route: '/alerts/rules',
    title: 'Alert Rules',
    icon: '🔔',
    summary: 'Define conditions that trigger notifications when metrics cross thresholds.',
    sections: [
      {
        heading: 'Creating a rule',
        body: 'Click "+ New Rule". Choose the agent, metric (e.g. cpu_percent), operator (> < = ≥ ≤), and threshold value. Give it a name and save.',
        tip: 'Rules evaluate on every metric ingestion — typically every 10–60 seconds depending on agent interval.',
      },
      {
        heading: 'Grace period',
        body: 'A built-in 60-second grace period prevents alert floods during brief spikes. An alert only fires if the condition holds continuously past the grace window.',
      },
      {
        heading: 'Notification channels',
        body: 'Rules fire to all active notification channels (Gotify, ntfy, Email, Webhook). Configure channels in Settings → Notification Channels.',
      },
      {
        heading: 'Enable / Disable',
        body: 'Toggle the enabled switch on any rule to pause it without deleting it. Useful during maintenance windows.',
      },
    ],
  },

  // ── Incident Log ─────────────────────────────────────────────────────────────
  {
    route: '/alerts/incidents',
    title: 'Incident Log',
    icon: '📋',
    summary: 'Timeline of every alert fired — when it started, when it resolved, and the full context.',
    sections: [
      {
        heading: 'Reading the log',
        body: 'Each row shows the rule that fired, the agent, the metric value that triggered it, the start time, and (if resolved) the end time.',
      },
      {
        heading: 'Open vs Resolved',
        body: 'A red "Open" badge means the condition is still active. A green "Resolved" badge means the metric returned to normal.',
        tip: 'Use the filter bar to show only open incidents during an outage investigation.',
      },
      {
        heading: 'Export',
        body: 'Download the incident log as CSV for postmortems or compliance reporting.',
      },
    ],
  },

  // ── Plugins ──────────────────────────────────────────────────────────────────
  {
    route: '/plugins',
    title: 'Plugins',
    icon: '🧩',
    summary: 'Run custom shell scripts on agents and display their output as structured metrics.',
    sections: [
      {
        heading: 'What is a plugin?',
        body: 'A shell script placed in the agent\'s plugins/ folder. It outputs a JSON object with key-value pairs that the agent forwards to the backend on each run.',
        tip: 'Example plugins: disk_usage.sh, ssl_expiry.sh, http_status.sh, ping_check.sh.',
      },
      {
        heading: 'Plugin output format',
        body: 'Scripts must print a JSON object to stdout — e.g. {"free_gb": 42.1, "used_pct": 68}. Any additional data is captured but must be valid JSON.',
      },
      {
        heading: 'Scheduling',
        body: 'Plugins run on the same interval as the agent\'s main metrics push. Adjust the agent\'s interval_s setting to control frequency.',
      },
      {
        heading: 'Enabling / Disabling',
        body: 'Toggle plugins on/off from this page without touching the agent binary. Disabled plugins are skipped on the next run.',
      },
    ],
  },

  // ── Settings ─────────────────────────────────────────────────────────────────
  {
    route: '/settings',
    title: 'Settings',
    icon: '⚙',
    summary: 'API keys, notification channels, import/export config, and account management.',
    sections: [
      {
        heading: 'API Keys',
        body: 'Generate and manage API keys for agents. Each key is shown only once — copy it immediately. Revoke compromised keys by deleting them.',
        tip: 'Use descriptive names (e.g. "web-server-01") so you know which agent uses which key.',
      },
      {
        heading: 'Notification Channels',
        body: 'Configure where alerts go:\n• Gotify — self-hosted push server.\n• ntfy — simple pub/sub notifications.\n• Email — SMTP outbound.\n• Webhook — POST JSON payload to any URL.',
        tip: 'Click "Test" to send a test notification and confirm delivery before relying on a channel.',
      },
      {
        heading: 'Export / Import config',
        body: 'Export all monitors, alert rules, and notification channels as a JSON file. Use Import to restore or migrate to a new server.',
        tip: 'Sensitive fields (passwords, tokens) are masked as *** on export. Paste real values before importing to a new instance.',
      },
      {
        heading: 'Change password',
        body: 'Update your admin password from the Account section. Use a strong passphrase — this is the only account protecting all your infrastructure.',
      },
    ],
  },

  // ── Agent Detail ─────────────────────────────────────────────────────────────
  {
    route: /^\/agents\/\d+/,
    title: 'Agent Detail',
    icon: '🖥',
    summary: 'Deep-dive metrics, processes, network, and logs for a single agent.',
    sections: [
      {
        heading: 'Metric cards',
        body: 'CPU, RAM, disk, and network totals are shown at the top. Each card has a sparkline showing the last 30 data points.',
      },
      {
        heading: 'Process list',
        body: 'Live process table sorted by CPU. Refresh interval matches the agent\'s reporting interval. Useful for spotting runaway processes.',
        tip: 'Click a column header to re-sort by PID, name, CPU%, or RAM.',
      },
      {
        heading: 'Capabilities',
        body: 'The Capabilities panel shows which features the agent supports (exec, logs, network, docker…). Capabilities not installed are greyed out.',
      },
      {
        heading: 'Log viewer',
        body: 'Stream live journald/syslog output directly in the browser. Use the search box to filter lines in real time.',
      },
      {
        heading: 'Restart agent',
        body: 'The "Restart" button triggers a syscall.Exec-based self-restart — the process replaces itself in-place, picking up any binary updates without losing its PID.',
      },
    ],
  },
]

/**
 * Find the guide entry for a given pathname.
 * Falls back to a generic "no guide" descriptor.
 */
export function findGuide(pathname) {
  return (
    NAVIGATOR_PAGES.find(p =>
      p.route instanceof RegExp
        ? p.route.test(pathname)
        : pathname.startsWith(p.route)
    ) ?? null
  )
}
