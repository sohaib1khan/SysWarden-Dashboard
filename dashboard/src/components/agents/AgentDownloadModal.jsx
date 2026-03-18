import { useState, useEffect, useCallback } from 'react'
import Card from '../common/Card.jsx'

// ── Data ───────────────────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    id:     'linux-amd64',
    label:  'Linux x86-64',
    icon:   '🐧',
    binary: 'agent-linux-amd64',
    script: 'install.sh',
  },
  {
    id:     'linux-amd64-static',
    label:  'Linux x86-64 (static)',
    icon:   '🐧',
    binary: 'agent-linux-amd64-static',
    script: 'install.sh',
  },
  {
    id:     'linux-arm64',
    label:  'Linux ARM64',
    icon:   '🐧',
    binary: 'agent-linux-arm64',
    script: 'install.sh',
    soon:   true,
  },
  {
    id:     'darwin-amd64',
    label:  'macOS Intel',
    icon:   '🍎',
    binary: 'agent-darwin-amd64',
    script: null,
    soon:   true,
  },
  {
    id:     'darwin-arm64',
    label:  'macOS Apple Silicon',
    icon:   '🍎',
    binary: 'agent-darwin-arm64',
    script: null,
    soon:   true,
  },
  {
    id:     'windows-amd64',
    label:  'Windows x64',
    icon:   '🪟',
    binary: 'agent-windows-amd64.exe',
    script: null,
    soon:   true,
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return ''
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600
                 text-gray-300 hover:text-white transition-colors select-none"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ code }) {
  return (
    <div className="relative">
      <pre className="bg-gray-950 text-green-400 text-xs rounded-lg p-4 pr-16 overflow-x-auto
                      leading-relaxed whitespace-pre-wrap break-words">
        {code.trim()}
      </pre>
      <CopyButton text={code.trim()} />
    </div>
  )
}

// ── Install method content ─────────────────────────────────────────────────────

function QuickInstall({ platform, backendUrl }) {
  const scriptUrl  = `${backendUrl}/api/v1/agent/download/install.sh`

  const code = `# 1 · Download the install script (auto-downloads the right binary)
curl -fLO ${scriptUrl}

# 2 · Install (downloads agent, creates systemd service, starts on boot)
SYSWARDEN_BACKEND_URL=${backendUrl} \\
  sudo bash install.sh install

# ── Manage ──────────────────────────────────────────────────────────
sudo bash install.sh status     # check service status
sudo bash install.sh logs       # stream live logs
sudo bash install.sh reinstall  # pull latest binary and restart
sudo bash install.sh uninstall  # stop + remove service`

  const rhel = `# RHEL / CentOS / AlmaLinux / Rocky — static binary is auto-selected.
# To force it explicitly (e.g. if auto-detect fails):
SYSWARDEN_STATIC=1 SYSWARDEN_BACKEND_URL=${backendUrl} \\
  sudo bash install.sh install`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-300">
        The <code className="text-indigo-300">install.sh</code> script detects your arch and glibc
        version, downloads the correct binary, creates a systemd service, and starts it on boot.
        Run with <code className="text-indigo-300">sudo</code>.
      </p>
      <CodeBlock code={code} />
      <div className="text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3 flex flex-col gap-2">
        <div>
          <span className="text-yellow-400 font-medium">💡 Tip:</span>{' '}
          <code className="text-indigo-300">SYSWARDEN_BACKEND_URL</code> is pre-filled from your
          current session. Override <code className="text-indigo-300">SYSWARDEN_INTERVAL=10</code> or
          supply a local binary with{' '}<code className="text-indigo-300">SYSWARDEN_BINARY=…</code>
        </div>
        <div>
          <span className="text-orange-400 font-medium">🐧 RHEL / CentOS / AlmaLinux / Rocky:</span>
          {' '}Old-glibc distros are auto-detected and get the static build.
          Force with <code className="text-indigo-300">SYSWARDEN_STATIC=1</code> or
          override with <code className="text-indigo-300">SYSWARDEN_STATIC=0</code> for dynamic.
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-300 select-none">
          🔴 RHEL explicit static install
        </summary>
        <div className="mt-2">
          <CodeBlock code={rhel} />
        </div>
      </details>
    </div>
  )
}

function ManualRun({ platform, backendUrl }) {
  const binaryUrl = `${backendUrl}/api/v1/agent/download/${platform.binary}`

  const code = `# 1 · Download the binary
curl -fLO ${binaryUrl}
chmod +x ${platform.binary}

# 2 · Run directly (stops when you close the terminal)
#     Replace YOUR_API_KEY with a key from Settings → API Keys
SYSWARDEN_BACKEND_URL=${backendUrl} \\
  SYSWARDEN_API_KEY=YOUR_API_KEY \\
  SYSWARDEN_INTERVAL=10 \\
  ./${platform.binary}`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-300">
        Run the agent directly in your terminal without a system service.
        Useful for testing or for environments without systemd.
      </p>
      <CodeBlock code={code} />
    </div>
  )
}

function SystemdManual({ platform, backendUrl }) {
  const binaryUrl = `${backendUrl}/api/v1/agent/download/${platform.binary}`

  const code = `# 1 · Download and install the binary
curl -fLO ${binaryUrl}
chmod +x ${platform.binary}
sudo mv ${platform.binary} /usr/local/bin/syswarden-agent

# 2 · Create the systemd service
sudo tee /etc/systemd/system/syswarden-agent.service <<'EOF'
[Unit]
Description=SysWarden Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Environment="HOME=$HOME"
Environment="SYSWARDEN_BACKEND_URL=${backendUrl}"
Environment="SYSWARDEN_API_KEY=YOUR_API_KEY"
Environment="SYSWARDEN_INTERVAL=10"
ExecStart=/usr/local/bin/syswarden-agent
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 3 · Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now syswarden-agent
sudo systemctl status syswarden-agent`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-300">
        Set up the systemd service manually — useful when you want full control
        over the unit file or are deploying via config management (Ansible, Chef, etc.).
      </p>
      <CodeBlock code={code} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const TABS = [
  { id: 'quick',   label: '🚀 Quick install' },
  { id: 'manual',  label: '⚙ Manual run' },
  { id: 'systemd', label: '🐧 Systemd (manual)' },
]

export default function AgentDownloadModal({ onClose }) {
  const [availableFiles, setAvailableFiles] = useState([])
  const [platform,       setPlatform]       = useState(PLATFORMS[0])
  const [tab,            setTab]            = useState('quick')

  // The canonical backend URL — pre-fills install snippets.
  // Uses the current page origin so it works whether accessed via the
  // Cloudflare tunnel (https://syswarden.helixx.cloud) or a local LAN address.
  const backendUrl = window.location.origin

  // Load which binaries are actually available on disk
  useEffect(() => {
    fetch('/api/v1/agent/downloads')
      .then(r => r.ok ? r.json() : [])
      .then(setAvailableFiles)
      .catch(() => setAvailableFiles([]))
  }, [])

  function isAvailable(filename) {
    return availableFiles.some(f => f.name === filename)
  }

  function fileSize(filename) {
    const f = availableFiles.find(f => f.name === filename)
    return f ? fmtBytes(f.size) : ''
  }

  // Close on Escape or backdrop click
  const handleBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasBinary = isAvailable(platform.binary)
  const hasScript = platform.script ? isAvailable(platform.script) : false

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-start justify-center z-50
                 px-4 py-8 overflow-y-auto"
      onClick={handleBackdrop}
    >
      <Card className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">📥 Get SysWarden Agent</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Lightweight Go binary — streams metrics to this backend over WebSocket.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xl font-light ml-4"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Platform selector */}
        <div className="mb-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Platform</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => {
              const active = p.id === platform.id
              return (
                <button
                  key={p.id}
                  disabled={p.soon}
                  onClick={() => { setPlatform(p); setTab('quick') }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    transition-colors border
                    ${active
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : p.soon
                        ? 'bg-gray-800/40 border-gray-700/40 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                  {p.soon && <span className="text-gray-600">(soon)</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Download buttons — use absolute URLs so links work from remote networks */}
        <div className="flex flex-wrap gap-2 mb-5">
          <a
            href={hasBinary ? `${backendUrl}/api/v1/agent/download/${platform.binary}` : undefined}
            download
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${hasBinary
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed pointer-events-none'
              }`}
          >
            ⬇ Binary
            {hasBinary && fileSize(platform.binary) && (
              <span className="text-indigo-200 text-xs">{fileSize(platform.binary)}</span>
            )}
            {!hasBinary && <span className="text-xs">(not available)</span>}
          </a>

          {platform.script && (
            <a
              href={hasScript ? `${backendUrl}/api/v1/agent/download/${platform.script}` : undefined}
              download
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${hasScript
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed pointer-events-none'
                }`}
            >
              ⬇ install.sh
              {!hasScript && <span className="text-xs">(not available)</span>}
            </a>
          )}
        </div>

        {/* Install method tabs */}
        {platform.soon ? (
          <div className="text-sm text-gray-500 text-center py-6 bg-gray-800/40 rounded-lg">
            Support for <span className="text-gray-300">{platform.label}</span> is coming soon.
          </div>
        ) : (
          <>
            <div className="flex gap-1 mb-4 border-b border-gray-800">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors
                    ${tab === t.id
                      ? 'bg-gray-800 text-white border-b-2 border-indigo-500 -mb-px'
                      : 'text-gray-500 hover:text-gray-300'
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div>
              {tab === 'quick'   && <QuickInstall  platform={platform} backendUrl={backendUrl} />}
              {tab === 'manual'  && <ManualRun     platform={platform} backendUrl={backendUrl} />}
              {tab === 'systemd' && <SystemdManual platform={platform} backendUrl={backendUrl} />}
            </div>
          </>
        )}

        {/* API key reminder */}
        <div className="mt-5 p-3 rounded-lg bg-yellow-900/20 border border-yellow-700/30 text-xs text-yellow-300/80">
          <span className="font-semibold text-yellow-300">🔑 API Key required</span> — generate one in{' '}
          <a href="/settings" className="underline hover:text-yellow-200" onClick={onClose}>
            Settings → API Keys
          </a>{' '}
          before running the agent. The key is shown only once, so copy it immediately.
        </div>
      </Card>
    </div>
  )
}
