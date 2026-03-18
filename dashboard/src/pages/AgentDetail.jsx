import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useMetrics } from '../hooks/useMetrics.js'
import { useAgents } from '../hooks/useAgents.js'
import { useFetch } from '../hooks/useFetch.js'
import { useKeyStore } from '../store/keyStore.js'
import KeyManager from '../components/agents/KeyManager.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import StatusBadge from '../components/charts/StatusBadge.jsx'
import Card from '../components/common/Card.jsx'
import LogViewer from '../components/capabilities/LogViewer.jsx'
import NetworkCheck from '../components/capabilities/NetworkCheck.jsx'
import DockerList from '../components/capabilities/DockerList.jsx'
import K8sList from '../components/capabilities/K8sList.jsx'
import VirtList from '../components/capabilities/VirtList.jsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtNum(v, decimals = 1) {
  if (v == null || isNaN(v)) return '—'
  return (+v).toFixed(decimals)
}

function lv(arr) {
  return arr?.at(-1)?.value ?? null
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, sub, colorClass = 'text-gray-200', warn = false }) {
  return (
    <div
      className={`rounded-lg px-3 py-2.5 border ${
        warn
          ? 'bg-amber-900/15 border-amber-500/30'
          : 'bg-gray-800/60 border-gray-700/50'
      }`}
    >
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-semibold leading-snug ${warn ? 'text-amber-300' : colorClass}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── HealthPanel ──────────────────────────────────────────────────────────────

function HealthPanel({ cpuPct, memPct, diskPct, swapPct }) {
  const concerns = []

  if (cpuPct != null) {
    if (cpuPct >= 95) concerns.push({ level: 'critical', msg: `CPU at ${cpuPct}% — critical load` })
    else if (cpuPct >= 85) concerns.push({ level: 'warning', msg: `CPU at ${cpuPct}% — high utilization` })
  }
  if (memPct != null) {
    if (memPct >= 92) concerns.push({ level: 'critical', msg: `Memory at ${memPct}% — near capacity` })
    else if (memPct >= 80) concerns.push({ level: 'warning', msg: `Memory at ${memPct}% — high usage` })
  }
  if (diskPct != null) {
    if (diskPct >= 90) concerns.push({ level: 'critical', msg: `Disk at ${diskPct}% — critically low space` })
    else if (diskPct >= 75) concerns.push({ level: 'warning', msg: `Disk at ${diskPct}% — limited free space` })
  }
  if (swapPct != null && swapPct > 0) {
    if (swapPct >= 50) concerns.push({ level: 'warning', msg: `Swap at ${swapPct}% — memory pressure` })
    else if (swapPct >= 20) concerns.push({ level: 'info', msg: `Swap active at ${swapPct}%` })
  }

  if (concerns.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-emerald-900/10 border-emerald-700/25 text-sm text-emerald-400">
        <span>✓</span> All monitored metrics within normal ranges
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {concerns.map((c, i) => (
        <div
          key={i}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${
            c.level === 'critical'
              ? 'bg-red-900/20 border-red-700/35 text-red-300'
              : c.level === 'warning'
              ? 'bg-amber-900/20 border-amber-700/35 text-amber-300'
              : 'bg-sky-900/20 border-sky-700/35 text-sky-300'
          }`}
        >
          <span className="shrink-0">
            {c.level === 'critical' ? '🔴' : c.level === 'warning' ? '🟡' : 'ℹ'}
          </span>
          {c.msg}
        </div>
      ))}
    </div>
  )
}

// ─── AutoProcessPanel ─────────────────────────────────────────────────────────

function AutoProcessPanel({ agentId, agentOnline }) {
  const { run, data, loading, error } = useFetch(agentId)
  const apiKey = useKeyStore((s) => s.keys[agentId])
  const [lastUpdated, setLastUpdated] = useState(null)

  // Auto-fetch on mount and every 30 s when key is available and agent is online
  useEffect(() => {
    if (!apiKey || !agentOnline) return
    const doFetch = () => {
      run('sys.processes', { limit: 10 })
      setLastUpdated(new Date())
    }
    doFetch()
    const timer = setInterval(doFetch, 30_000)
    return () => clearInterval(timer)
  }, [apiKey, agentOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!agentOnline) {
    return <p className="text-sm text-gray-500 py-4 text-center">Agent offline — process list unavailable.</p>
  }

  if (!apiKey) {
    return (
      <p className="text-sm text-gray-500 py-1">
        Set the agent API key in the <span className="text-gray-400 font-medium">Capabilities</span> panel below to enable auto-refresh.
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">
          Top 10 by CPU · auto-refresh every 30 s
          {lastUpdated && (
            <span className="ml-2 text-gray-600">· last {lastUpdated.toLocaleTimeString()}</span>
          )}
        </span>
        <button
          onClick={() => { run('sys.processes', { limit: 10 }); setLastUpdated(new Date()) }}
          disabled={loading}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-opacity"
        >
          {loading ? 'Refreshing…' : '↺ Refresh'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-xs text-gray-600 py-6 text-center">Loading…</div>
      )}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700/70">
                <th className="pb-1.5 pr-4 font-normal">PID</th>
                <th className="pb-1.5 pr-4 font-normal">Name</th>
                <th className="pb-1.5 pr-4 font-normal">CPU %</th>
                <th className="pb-1.5 pr-4 font-normal">Mem MB</th>
                <th className="pb-1.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.pid} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="py-1.5 pr-4 font-mono text-gray-600">{p.pid}</td>
                  <td className="py-1.5 pr-4 font-medium text-white">{p.name}</td>
                  <td
                    className={`py-1.5 pr-4 font-mono tabular-nums ${
                      p.cpu_pct > 50 ? 'text-red-300' : p.cpu_pct > 15 ? 'text-amber-300' : 'text-indigo-300'
                    }`}
                  >
                    {p.cpu_pct}%
                  </td>
                  <td className="py-1.5 pr-4 text-gray-300 font-mono tabular-nums">{p.mem_mb}</td>
                  <td className="py-1.5 text-gray-500">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── MetricPanel (chart card) ─────────────────────────────────────────────────

function MetricPanel({ agentId, metric }) {
  const { data, error } = useMetrics(agentId, metric.key)
  const latest = data.at(-1)
  return (
    <Card title={metric.label}>
      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : (
        <>
          <div className="text-3xl font-bold mb-3" style={{ color: metric.color }}>
            {latest ? `${latest.value}${metric.unit}` : '—'}
          </div>
          <LineChart data={data} dataKey="value" unit={metric.unit} color={metric.color} />
        </>
      )}
    </Card>
  )
}

const CHART_METRICS = [
  { key: 'sys.cpu.percent',  label: 'CPU Usage',    unit: '%',  color: '#818cf8' },
  { key: 'sys.mem.percent',  label: 'Memory Usage', unit: '%',  color: '#34d399' },
  { key: 'sys.disk.percent', label: 'Disk Usage',   unit: '%',  color: '#fb923c' },
]

// All capability tabs — always shown so users can discover and use them
// even if the agent was registered with an older binary.
const CAPABILITIES = [
  { id: 'logs',    label: 'Log Viewer',      component: LogViewer    },
  { id: 'network', label: 'Network Check',   component: NetworkCheck  },
  { id: 'docker',  label: '🐳 Docker',       component: DockerList   },
  { id: 'k8s',     label: '☸ Kubernetes',    component: K8sList      },
  { id: 'virt',    label: '🖥 VMs / Podman', component: VirtList     },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentDetail() {
  const { agentId } = useParams()
  const { agents } = useAgents(30_000)
  const agent = agents.find((a) => a.id === agentId)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'logs')

  const handleTabChange = (id) => {
    setActiveTab(id)
    setSearchParams({ tab: id }, { replace: true })
  }

  // ── Stats strip data (latest value only) ──────────────────────────────────
  const { data: uptimeData }    = useMetrics(agentId, 'sys.uptime_s',      { maxPoints: 2 })
  const { data: memUsedData }   = useMetrics(agentId, 'sys.mem.used_mb',   { maxPoints: 2 })
  const { data: memTotalData }  = useMetrics(agentId, 'sys.mem.total_mb',  { maxPoints: 2 })
  const { data: diskUsedData }  = useMetrics(agentId, 'sys.disk.used_gb',  { maxPoints: 2 })
  const { data: diskTotalData } = useMetrics(agentId, 'sys.disk.total_gb', { maxPoints: 2 })
  const { data: swapPctData }   = useMetrics(agentId, 'sys.swap.percent',  { maxPoints: 2 })
  const { data: load1Data }     = useMetrics(agentId, 'sys.load.1',        { maxPoints: 2 })
  const { data: load5Data }     = useMetrics(agentId, 'sys.load.5',        { maxPoints: 2 })
  const { data: load15Data }    = useMetrics(agentId, 'sys.load.15',       { maxPoints: 2 })
  const { data: netRxData }     = useMetrics(agentId, 'sys.net.rx_kb_s',   { maxPoints: 2 })
  const { data: netTxData }     = useMetrics(agentId, 'sys.net.tx_kb_s',   { maxPoints: 2 })

  // ── Health panel data ──────────────────────────────────────────────────────
  const { data: cpuPctData }  = useMetrics(agentId, 'sys.cpu.percent',  { maxPoints: 2 })
  const { data: memPctData }  = useMetrics(agentId, 'sys.mem.percent',  { maxPoints: 2 })
  const { data: diskPctData } = useMetrics(agentId, 'sys.disk.percent', { maxPoints: 2 })

  // Derived latest values
  const uptimeSec  = lv(uptimeData)
  const memUsedMb  = lv(memUsedData)
  const memTotalMb = lv(memTotalData)
  const diskUsedGb = lv(diskUsedData)
  const diskTotGb  = lv(diskTotalData)
  const swapPct    = lv(swapPctData)
  const load1      = lv(load1Data)
  const load5      = lv(load5Data)
  const load15     = lv(load15Data)
  const netRx      = lv(netRxData)
  const netTx      = lv(netTxData)

  const ramLabel =
    memUsedMb != null && memTotalMb != null
      ? `${fmtNum(memUsedMb / 1024)} / ${fmtNum(memTotalMb / 1024)} GB`
      : lv(memPctData) != null ? `${fmtNum(lv(memPctData))}%` : '—'

  const diskLabel =
    diskUsedGb != null && diskTotGb != null
      ? `${fmtNum(diskUsedGb)} / ${fmtNum(diskTotGb)} GB`
      : lv(diskPctData) != null ? `${fmtNum(lv(diskPctData))}%` : '—'

  const agentCaps = agent?.capabilities || []

  const ActivePanel = CAPABILITIES.find((c) => c.id === activeTab)?.component
    ?? CAPABILITIES[0]?.component

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-1">
        <Link to="/overview" className="text-gray-500 hover:text-white text-sm">
          ← Overview
        </Link>
        <h1 className="text-2xl font-bold">{agent?.hostname ?? agentId}</h1>
        {agent && <StatusBadge online={agent.online} />}
      </div>
      {agent && (
        <p className="text-xs text-gray-600 font-mono mb-5">ID: {agent.id}</p>
      )}

      {/* ── Stats Strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        <StatPill
          label="Uptime"
          value={formatUptime(uptimeSec)}
          colorClass="text-sky-300"
        />
        <StatPill
          label="RAM"
          value={ramLabel}
          warn={lv(memPctData) != null && lv(memPctData) >= 80}
          colorClass="text-emerald-300"
        />
        <StatPill
          label="Disk"
          value={diskLabel}
          warn={lv(diskPctData) != null && lv(diskPctData) >= 75}
          colorClass="text-orange-300"
        />
        <StatPill
          label="Swap"
          value={swapPct != null ? `${fmtNum(swapPct)}%` : '—'}
          warn={swapPct != null && swapPct >= 20}
          colorClass="text-purple-300"
        />
        <StatPill
          label="Load avg"
          value={load1 != null ? `${fmtNum(load1, 2)} / ${fmtNum(load5, 2)} / ${fmtNum(load15, 2)}` : '—'}
          sub={load1 != null ? '1 / 5 / 15 min' : null}
          colorClass="text-indigo-300"
        />
        <StatPill
          label="Network I/O"
          value={netRx != null ? `↓${fmtNum(netRx)} ↑${fmtNum(netTx)} KB/s` : '—'}
          colorClass="text-cyan-300"
        />
      </div>

      {/* ── Health Status ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Health Status
        </p>
        <HealthPanel
          cpuPct={lv(cpuPctData)}
          memPct={lv(memPctData)}
          diskPct={lv(diskPctData)}
          swapPct={swapPct}
        />
      </div>

      {/* ── Metric Charts ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {CHART_METRICS.map((m) => (
          <MetricPanel key={m.key} agentId={agentId} metric={m} />
        ))}
      </div>

      {/* ── Running Processes (auto-refresh) ───────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Running Processes</h2>
          {agent?.online && (
            <span className="text-xs text-gray-600">auto-refresh · 30 s</span>
          )}
        </div>
        <div className="p-4">
          <AutoProcessPanel agentId={agentId} agentOnline={agent?.online ?? false} />
        </div>
      </div>

      {/* ── On-demand Capabilities ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-gray-300">On-demand Capabilities</h2>
          <KeyManager agentId={agentId} agentOnline={agent?.online ?? false} />
        </div>

        <div className="flex border-b border-gray-700 overflow-x-auto">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap.id}
              onClick={() => handleTabChange(cap.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === cap.id
                  ? 'text-white border-b-2 border-indigo-500'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {cap.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {ActivePanel && <ActivePanel agentId={agentId} capabilities={agentCaps} />}
        </div>
      </div>
    </div>
  )
}
