import { useAgents } from '../hooks/useAgents.js'
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../components/charts/StatusBadge.jsx'
import PushToggle from '../components/common/PushToggle.jsx'
import { api } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return 'Never'
  // FastAPI returns naive UTC datetimes — append Z so the browser parses correctly
  const raw = typeof ts === 'string' && !ts.endsWith('Z') ? ts + 'Z' : ts
  const secs = Math.floor((Date.now() - new Date(raw).getTime()) / 1000)
  if (secs < 5)   return 'Just now'
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return s > 0 ? `${m}m ${s}s ago` : `${m}m ago`
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`
  }
  return `${Math.floor(secs / 86400)}d ago`
}

const CAP_GROUPS = {
  'sys.metrics':    { icon: '📊', short: 'metrics', tab: null         },
  'sys.processes':  { icon: '⚙️',  short: 'procs',   tab: 'processes'  },
  'sys.logs':       { icon: '📄', short: 'logs',    tab: 'logs'       },
  'sys.files':      { icon: '📁', short: 'files',   tab: null         },
  'sys.network':    { icon: '🌐', short: 'net',     tab: 'network'    },
  'sys.exec':       { icon: '💻', short: 'exec',    tab: null         },
  'docker.list':    { icon: '🐳', short: 'docker',  tab: 'docker'     },
  'docker.logs':    { icon: '🐳', short: 'dk.logs', tab: 'docker'     },
  'k8s.pods':       { icon: '☸',  short: 'k8s',     tab: 'k8s'        },
  'k8s.nodes':      { icon: '☸',  short: 'nodes',   tab: 'k8s'        },
  'virt.vms':           { icon: '🖥',  short: 'kvm',     tab: 'virt'       },
  'podman.list':        { icon: '🦭', short: 'podman',  tab: 'virt'       },
  'proxmox.list_vms':   { icon: '🔷', short: 'proxmox', tab: 'virt'       },
}

// Environment stacks shown as prominent badges on the card
const ENV_STACKS = [
  { cap: 'docker.list',       icon: '🐳', label: 'Docker',     tab: 'docker', color: 'text-blue-300 border-blue-700/50 bg-blue-900/20'     },
  { cap: 'k8s.pods',          icon: '☸',  label: 'Kubernetes', tab: 'k8s',    color: 'text-cyan-300 border-cyan-700/50 bg-cyan-900/20'     },
  { cap: 'virt.vms',          icon: '🖥',  label: 'KVM/VMs',    tab: 'virt',   color: 'text-purple-300 border-purple-700/50 bg-purple-900/20' },
  { cap: 'proxmox.list_vms',  icon: '🔷', label: 'Proxmox',    tab: 'virt',   color: 'text-indigo-300 border-indigo-700/50 bg-indigo-900/20' },
  { cap: 'podman.list',       icon: '🦭', label: 'Podman',     tab: 'virt',   color: 'text-red-300 border-red-700/50 bg-red-900/20'         },
]

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({ agent }) {
  const [pingState, setPingState] = useState(null) // null | 'pinging' | result

  const handlePing = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setPingState('pinging')
    const t0 = performance.now()
    try {
      const data = await api.get(`/api/v1/agents/${agent.id}/ping`)
      const rtt = Math.round(performance.now() - t0)
      setPingState({ rtt, connected: data.connected, online: data.online, lastSeenS: data.last_seen_s })
    } catch {
      setPingState({ error: true })
    }
    // Clear result after 8 seconds
    setTimeout(() => setPingState(null), 8000)
  }, [agent.id])

  const caps  = agent.capabilities || []

  const borderColor = agent.online ? 'border-gray-700 hover:border-indigo-500/70' : 'border-gray-800/70 hover:border-gray-700'
  const accentColor = agent.online ? 'bg-green-400' : 'bg-gray-700'

  return (
    <Link to={`/agents/${agent.id}`} className="block h-full">
      <div className={`relative bg-gray-900/60 border ${borderColor} rounded-xl p-4 transition-all h-full flex flex-col`}>

        {/* Left accent stripe */}
        <div className={`absolute left-0 top-4 bottom-4 w-[3px] rounded-full ${accentColor}`} />

        {/* Header row */}
        <div className="flex items-start justify-between gap-2 pl-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-bold text-white text-base leading-tight truncate">{agent.hostname}</h3>
            <p className="text-[10px] text-gray-600 font-mono truncate mt-0.5">{agent.id}</p>
          </div>
          <StatusBadge online={agent.online} />
        </div>

        {/* Info grid */}
        <div className="pl-3 grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-xs">
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Last seen</div>
            <div className={`font-medium ${agent.online ? 'text-green-400' : 'text-gray-400'}`}>
              {timeAgo(agent.last_seen)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Registered</div>
            <div className="text-gray-400">{timeAgo(agent.registered_at)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Capabilities</div>
            <div className="text-gray-300 font-medium">{caps.length}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Status</div>
            <div className={`font-medium ${agent.online ? 'text-green-400' : 'text-red-400'}`}>
              {agent.online ? 'Online' : 'Offline'}
            </div>
          </div>
        </div>

        {/* Capability tags */}
        {caps.length > 0 && (
          <div className="pl-3 flex flex-wrap gap-1 mb-3 flex-1">
            {caps.map((cap) => {
              const meta = CAP_GROUPS[cap]
              const label = meta ? `${meta.icon} ${meta.short}` : cap
              const dest = meta?.tab
                ? `/agents/${agent.id}?tab=${meta.tab}`
                : `/agents/${agent.id}`
              return (
                <Link
                  key={cap}
                  to={dest}
                  title={cap}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] bg-gray-800/80 text-gray-400 border border-gray-700/60 px-1.5 py-0.5 rounded-full hover:bg-indigo-900/50 hover:text-indigo-300 hover:border-indigo-500/60 transition-colors"
                >
                  {label}
                </Link>
              )
            })}
          </div>
        )}

        {/* Environment stack badges (Docker / K8s / KVM / Podman) */}
        {ENV_STACKS.some(e => caps.includes(e.cap)) && (
          <div className="pl-3 flex flex-wrap gap-1.5 mb-3">
            {ENV_STACKS.filter(e => caps.includes(e.cap)).map(env => (
              <Link
                key={env.cap}
                to={`/agents/${agent.id}?tab=${env.tab}`}
                onClick={(e) => e.stopPropagation()}
                className={`text-[11px] font-medium px-2 py-0.5 rounded border ${env.color} transition-opacity hover:opacity-80 flex items-center gap-1`}
              >
                <span>{env.icon}</span>
                <span>{env.label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Ping bar */}
        <div className="pl-3 pt-2.5 border-t border-gray-800/60 flex items-center justify-between gap-2">
          <button
            onClick={handlePing}
            disabled={pingState === 'pinging'}
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 hover:border-indigo-400/50 disabled:opacity-50 transition-all px-2.5 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer select-none"
          >
            <span className={pingState === 'pinging' ? 'animate-spin inline-block' : ''}>⚡</span>
            {pingState === 'pinging' ? 'Pinging…' : 'Ping'}
          </button>

          {pingState && pingState !== 'pinging' && (
            <span className={`text-xs font-medium tabular-nums ${
              pingState.error
                ? 'text-red-400'
                : pingState.connected
                  ? 'text-green-400'
                  : 'text-yellow-400'
            }`}>
              {pingState.error
                ? '✕ unreachable'
                : pingState.connected
                  ? `✓ ${pingState.rtt}ms · live`
                  : `⚠ ${pingState.rtt}ms · disconnected`
              }
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Overview() {
  const { agents, loading, error } = useAgents()

  const online  = agents.filter((a) => a.online).length
  const offline = agents.length - online

  if (loading && agents.length === 0) {
    return <p className="text-gray-500 mt-8 text-center">Loading agents…</p>
  }

  if (error) {
    return <p className="text-red-400 mt-8 text-center">Error: {error}</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          {agents.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="text-green-400 font-medium">{online}</span> online
              {offline > 0 && <> · <span className="text-red-400 font-medium">{offline}</span> offline</>}
              {' '}· {agents.length} total
            </p>
          )}
        </div>
        <PushToggle />
      </div>

      {agents.length === 0 ? (
        <p className="text-gray-500">
          No agents registered yet. Start the agent binary on a host to get going.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}
