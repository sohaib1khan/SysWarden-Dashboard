import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { monitorsApi } from '../api/monitors.js'
import { useAuthStore } from '../store/authStore.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '—'
  const secs = Math.floor((Date.now() - new Date(ts + 'Z').getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const STATUS_CFG = {
  up: {
    ring: '#22c55e', bg: 'rgba(20,83,45,0.95)', glow: 'rgba(34,197,94,0.55)',
    anim: 'heartbeat 1.8s ease-in-out infinite',
    badge: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'Up',
    accent: 'border-green-500/25',
  },
  down: {
    ring: '#ef4444', bg: 'rgba(127,29,29,0.95)', glow: 'rgba(239,68,68,0.55)',
    anim: 'flatline 2s ease-in-out infinite',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Down',
    accent: 'border-red-500/35',
  },
  paused: {
    ring: '#eab308', bg: 'rgba(113,63,18,0.95)', glow: 'rgba(234,179,8,0.45)',
    anim: 'slow-pulse 3s ease-in-out infinite',
    badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', label: 'Paused',
    accent: 'border-yellow-500/25',
  },
  unknown: {
    ring: '#6b7280', bg: 'rgba(31,41,55,0.95)', glow: '',
    anim: 'none',
    badge: 'bg-gray-500/15 text-gray-400 border-gray-500/30', label: 'Unknown',
    accent: 'border-gray-700/60',
  },
}

function getCfg(status) { return STATUS_CFG[status] || STATUS_CFG.unknown }

// ── Animated live background ──────────────────────────────────────────────────

function LiveBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none" aria-hidden>
      <div className="absolute inset-0 bg-[#060a18]" />
      <div
        className="absolute -top-48 -left-48 w-[700px] h-[700px] rounded-full bg-indigo-600/[0.13] blur-[130px]"
        style={{ animation: 'orb-drift 18s ease-in-out infinite' }}
      />
      <div
        className="absolute top-1/2 -right-24 w-[500px] h-[500px] rounded-full bg-blue-500/[0.10] blur-[110px]"
        style={{ animation: 'orb-drift 24s ease-in-out infinite reverse', animationDelay: '3s' }}
      />
      <div
        className="absolute -bottom-20 left-1/3 w-[450px] h-[450px] rounded-full bg-cyan-500/[0.07] blur-[100px]"
        style={{ animation: 'orb-drift 22s ease-in-out infinite', animationDelay: '9s' }}
      />
      <div
        className="absolute inset-0 opacity-[0.022]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.8) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />
    </div>
  )
}

// ── Heartbeat orb ─────────────────────────────────────────────────────────────

function HeartbeatOrb({ status }) {
  const cfg = getCfg(status)
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{
        width: 54, height: 54,
        background: cfg.bg,
        border: `2px solid ${cfg.ring}`,
        boxShadow: cfg.glow ? `0 0 22px ${cfg.glow}, inset 0 0 12px ${cfg.glow}33` : 'none',
        animation: cfg.anim,
      }}
    >
      <div
        className="rounded-full"
        style={{ width: 20, height: 20, background: cfg.ring, opacity: 0.95 }}
      />
    </div>
  )
}

function typeIcon(type) {
  if (type === 'tcp')     return '🔌'
  if (type === 'keyword') return '🔍'
  return '🌐'
}

function formatRt(ms) {
  if (!ms) return null
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ── Uptime bar ────────────────────────────────────────────────────────────────

function UptimeBar({ events }) {
  const slots = events?.length > 0 ? events : Array(30).fill({ status: 'unknown' })
  return (
    <div className="flex gap-px items-end h-5">
      {slots.map((e, i) => {
        const color =
          e.status === 'up'   ? 'bg-green-500' :
          e.status === 'down' ? 'bg-red-500'   : 'bg-white/10'
        const ts = e.checked_at ? new Date(e.checked_at + 'Z').toLocaleString() : ''
        const rt = e.response_time_ms ? ` · ${Math.round(e.response_time_ms)}ms` : ''
        return (
          <div
            key={i}
            title={`${(e.status || 'unknown').toUpperCase()}${ts ? ' — ' + ts : ''}${rt}`}
            className={`flex-1 rounded-[2px] transition-all hover:opacity-70 cursor-default ${color}`}
            style={{ height: e.status === 'up' ? '100%' : e.status === 'down' ? '80%' : '30%' }}
          />
        )
      })}
    </div>
  )
}

// ── Quick stats ───────────────────────────────────────────────────────────────

function QuickStats({ monitors }) {
  const up     = monitors.filter(m => m.status === 'up').length
  const down   = monitors.filter(m => m.status === 'down').length
  const paused = monitors.filter(m => !m.enabled).length
  const avgUp  = monitors.length
    ? (monitors.reduce((s, m) => s + (m.uptime_percent || 0), 0) / monitors.length).toFixed(1)
    : '0.0'

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {[
        { label: 'Online',  value: up,         cls: 'text-green-400'  },
        { label: 'Down',    value: down,        cls: 'text-red-400'    },
        { label: 'Paused',  value: paused,      cls: 'text-yellow-400' },
        { label: 'Avg up',  value: avgUp + '%', cls: 'text-indigo-300' },
      ].map(({ label, value, cls }) => (
        <div
          key={label}
          className="bg-white/[0.04] border border-white/[0.07] rounded-xl p-3 text-center backdrop-blur-sm"
        >
          <div className={`text-xl font-bold ${cls}`}>{value}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Monitor form ──────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'http',    label: '🌐  HTTP / HTTPS', desc: 'Check URL returns 2xx–3xx' },
  { value: 'keyword', label: '🔍  Keyword',       desc: 'HTTP + search body'        },
  { value: 'tcp',     label: '🔌  TCP Port',      desc: 'Raw TCP connection'        },
]

function MonitorModal({ existing, defaultGroup = 'General', groups = [], onSave, onClose }) {
  const [form, setForm] = useState(existing ? {
    name:       existing.name,
    type:       existing.type,
    url:        existing.url,
    port:       existing.port ?? '',
    keyword:    existing.keyword ?? '',
    method:     existing.method,
    interval_s: existing.interval_s,
    timeout_s:  existing.timeout_s,
    group_name: existing.group_name ?? defaultGroup,
    ignore_tls:             existing.ignore_tls ?? false,
    cache_buster:           existing.cache_buster ?? false,
    upside_down:            existing.upside_down ?? false,
    notify_cert_expiry_days: existing.notify_cert_expiry_days ?? 0,
  } : {
    name: '', type: 'http', url: '', port: '', keyword: '',
    method: 'GET', interval_s: 60, timeout_s: 10, group_name: defaultGroup,
    ignore_tls: false, cache_buster: false, upside_down: false,
    notify_cert_expiry_days: 0,
  })
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [advExpanded,  setAdvExpanded]  = useState(
    !!(existing?.ignore_tls || existing?.cache_buster ||
       existing?.upside_down || existing?.notify_cert_expiry_days)
  )

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }))

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await onSave({
        name:       form.name.trim(),
        type:       form.type,
        url:        form.url.trim(),
        method:     form.method,
        interval_s: Number(form.interval_s),
        timeout_s:  Number(form.timeout_s),
        port:       form.port !== '' ? Number(form.port) : null,
        keyword:    form.keyword.trim() || null,
        group_name: form.group_name.trim() || 'General',
        ignore_tls:             form.ignore_tls,
        cache_buster:           form.cache_buster,
        upside_down:            form.upside_down,
        notify_cert_expiry_days: Number(form.notify_cert_expiry_days),
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800/80 sticky top-0 bg-gray-950 z-10">
          <div>
            <h2 className="text-base font-semibold text-white">{existing ? 'Edit Monitor' : 'Add Monitor'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{existing ? 'Update monitor settings' : 'Track uptime for a URL or TCP endpoint'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-lg">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <Field label="Group / Category">
            <input
              list="group-datalist"
              value={form.group_name}
              onChange={e => set('group_name', e.target.value)}
              className={INPUT}
              placeholder="General"
            />
            <datalist id="group-datalist">
              {groups.map(g => <option key={g} value={g} />)}
            </datalist>
          </Field>

          <Field label="Display name">
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              className={INPUT} placeholder="My Production API" />
          </Field>

          <Field label="Monitor type">
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map(({ value, label, desc }) => (
                <button key={value} type="button" onClick={() => set('type', value)}
                  className={`text-left p-3 rounded-lg border text-xs transition-all ${
                    form.type === value
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                      : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium mb-0.5 whitespace-nowrap">{label}</div>
                  <div className="text-gray-500 leading-tight">{desc}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label={form.type === 'tcp' ? 'Hostname / IP' : 'URL'}>
            <input required value={form.url} onChange={e => set('url', e.target.value)}
              className={INPUT + ' font-mono text-xs'}
              placeholder={form.type === 'tcp' ? 'db.internal or 192.168.1.10' : 'https://api.example.com/health'} />
          </Field>

          {form.type === 'tcp' && (
            <Field label="Port">
              <input type="number" min={1} max={65535} value={form.port}
                onChange={e => set('port', e.target.value)} className={INPUT} placeholder="5432" />
            </Field>
          )}
          {form.type === 'keyword' && (
            <Field label="Keyword to find in response body">
              <input value={form.keyword} onChange={e => set('keyword', e.target.value)}
                className={INPUT} placeholder="ok  /  healthy  /  true" />
            </Field>
          )}
          {form.type !== 'tcp' && (
            <Field label="HTTP method">
              <div className="flex gap-2">
                {['GET', 'HEAD'].map(m => (
                  <button key={m} type="button" onClick={() => set('method', m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.method === m
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                        : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                    }`}>{m}</button>
                ))}
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Check every (s)">
              <input type="number" min={10} value={form.interval_s}
                onChange={e => set('interval_s', e.target.value)} className={INPUT} />
            </Field>
            <Field label="Timeout (s)">
              <input type="number" min={1} max={60} value={form.timeout_s}
                onChange={e => set('timeout_s', e.target.value)} className={INPUT} />
            </Field>
          </div>

          {/* ── Advanced options ─────────────────────────── */}
          <div className="border border-gray-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvExpanded(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/[0.03] transition-colors"
            >
              <span className="flex items-center gap-1.5">⚙ Advanced options</span>
              <span className="text-[10px] opacity-60">{advExpanded ? '▲' : '▼'}</span>
            </button>

            {advExpanded && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-800/60">
                {/* Toggles */}
                {[
                  { field: 'ignore_tls',   label: 'Ignore TLS / SSL errors',
                    desc: 'Skip certificate validation (useful for self-signed certs)' },
                  { field: 'cache_buster', label: 'Cache buster',
                    desc: 'Append a random query param to bypass CDN caches' },
                  { field: 'upside_down',  label: 'Upside-down mode',
                    desc: 'Flip result — reachable = DOWN (for maintenance pages)' },
                ].map(({ field, label, desc }) => (
                  <label key={field} className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative mt-0.5 shrink-0">
                      <input
                        type="checkbox"
                        checked={form[field]}
                        onChange={e => set(field, e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-9 h-5 rounded-full border transition-colors ${
                        form[field]
                          ? 'bg-indigo-600 border-indigo-500'
                          : 'bg-gray-800 border-gray-700'
                      }`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          form[field] ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-300 group-hover:text-white transition-colors">{label}</div>
                      <div className="text-[11px] text-gray-600 leading-tight mt-0.5">{desc}</div>
                    </div>
                  </label>
                ))}

                {/* Cert expiry field */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                    🔐 Notify if cert expires within (days)
                    <span className="ml-1.5 text-gray-600 font-normal">0 = disabled</span>
                  </label>
                  <input
                    type="number" min={0} max={365}
                    value={form.notify_cert_expiry_days}
                    onChange={e => set('notify_cert_expiry_days', e.target.value)}
                    className={INPUT}
                    placeholder="0"
                  />
                  <p className="text-[11px] text-gray-600 mt-1 leading-tight">
                    HTTPS only. Fires a notification when the TLS cert expires within this many days.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2.5 rounded-lg">
              <span>⚠</span> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-600 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20">
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add monitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Droplet card ──────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

const INPUT = 'w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors'

function DropletCard({
  monitor, isAdmin,
  onToggle, onEdit, onDelete,
  isDragOver,
  onDragStart, onDragOver, onDrop,
}) {
  const [events,   setEvents]   = useState(null)
  const [toggling, setToggling] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const cfg = getCfg(monitor.status)

  useEffect(() => {
    monitorsApi.events(monitor.id, 60).then(setEvents).catch(() => setEvents([]))
  }, [monitor.id, monitor.last_checked])

  async function handleToggle(e) {
    e.stopPropagation()
    setToggling(true)
    await onToggle(monitor.id, !monitor.enabled)
    setToggling(false)
  }

  const isHttp = monitor.type !== 'tcp'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group relative rounded-2xl border overflow-hidden transition-all duration-200 cursor-grab active:cursor-grabbing ${cfg.accent} ${
        isDragOver ? 'ring-2 ring-indigo-500/50 scale-[0.97] opacity-75' : ''
      }`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Left status stripe */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ background: cfg.ring, opacity: 0.7 }}
      />

      <div className="pl-5 pr-3 pt-3 pb-3">
        {/* Row 1: orb + name/url + response time */}
        <div className="flex items-center gap-3">
          <HeartbeatOrb status={monitor.status} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-bold text-white leading-tight truncate max-w-[160px]">
                {monitor.name}
              </span>
              <span className="text-[10px] text-gray-600 bg-white/5 px-1.5 py-0.5 rounded-full font-mono whitespace-nowrap">
                {typeIcon(monitor.type)} {monitor.type.toUpperCase()}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                {cfg.label}
              </span>
            </div>
            {isHttp ? (
              <a
                href={monitor.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-gray-500 hover:text-indigo-400 font-mono truncate max-w-[220px] transition-colors"
                title={monitor.url}
              >
                <span className="truncate">{monitor.url}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">↗</span>
              </a>
            ) : (
              <p className="mt-0.5 text-[11px] text-gray-500 font-mono truncate">
                {monitor.url}{monitor.port ? `:${monitor.port}` : ''}
              </p>
            )}
          </div>

          <div className="shrink-0 text-right">
            {monitor.response_time_ms ? (
              <span className={`text-sm font-bold tabular-nums ${
                monitor.response_time_ms < 300  ? 'text-green-400'  :
                monitor.response_time_ms < 1000 ? 'text-yellow-400' : 'text-red-400'
              }`}>{formatRt(monitor.response_time_ms)}</span>
            ) : (
              <span className="text-xs text-gray-700">—</span>
            )}
            <div className="text-[10px] text-gray-600">latency</div>
          </div>
        </div>

        {/* Uptime bar */}
        <div className="mt-3 ml-[66px]">
          {events !== null ? (
            <UptimeBar events={events} />
          ) : (
            <div className="h-5 bg-white/5 rounded animate-pulse" />
          )}
        </div>

        {/* Row 3: uptime% + action buttons */}
        <div className="flex items-center justify-between mt-2 ml-[66px]">
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span>
              <span className="text-gray-300 font-semibold">
                {monitor.uptime_percent?.toFixed(1) ?? '—'}%
              </span>{' '}up
            </span>
            <span className="hidden sm:inline">checked {timeAgo(monitor.last_checked)}</span>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={handleToggle}
              disabled={toggling}
              title={monitor.enabled ? 'Pause' : 'Resume'}
              className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs transition-all disabled:opacity-40 ${
                monitor.enabled
                  ? 'text-gray-600 hover:text-yellow-400 hover:bg-yellow-400/10'
                  : 'text-yellow-500 hover:text-yellow-400 hover:bg-yellow-400/10'
              }`}
            >{monitor.enabled ? '⏸' : '▶'}</button>

            <button
              onClick={e => { e.stopPropagation(); onEdit(monitor) }}
              title="Edit"
              className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-600 hover:text-indigo-400 hover:bg-indigo-400/10 text-xs transition-all"
            >✎</button>

            {isAdmin && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(monitor.id) }}
                title="Delete"
                className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-700 hover:text-red-400 hover:bg-red-400/10 text-xs transition-all"
              >✕</button>
            )}

            <button
              onClick={() => setExpanded(v => !v)}
              title="Details"
              className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-700 hover:text-gray-300 hover:bg-white/5 text-[10px] transition-all"
            >{expanded ? '▲' : '▼'}</button>
          </div>
        </div>
      </div>

      {/* Expanded details panel */}
      {expanded && (
        <div className="px-4 pb-3 pt-3 border-t border-white/[0.06] bg-black/20 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ['Type',         monitor.type.toUpperCase()],
              ['Method',       monitor.method || '—'],
              ['Interval',     `${monitor.interval_s}s`],
              ['Timeout',      `${monitor.timeout_s}s`],
              ['Group',        monitor.group_name],
              ['Last checked', timeAgo(monitor.last_checked)],
            ].map(([k, v]) => (
              <div key={k} className="bg-white/[0.03] rounded-lg px-3 py-2">
                <div className="text-[10px] text-gray-600 uppercase tracking-wider">{k}</div>
                <div className="text-xs text-gray-300 mt-0.5 font-mono truncate">{v}</div>
              </div>
            ))}
          </div>
          {/* Advanced flags row */}
          {(monitor.ignore_tls || monitor.cache_buster || monitor.upside_down ||
            monitor.notify_cert_expiry_days > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {monitor.ignore_tls && (
                <span className="text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/25 px-2 py-0.5 rounded-full">
                  ⚠ TLS ignored
                </span>
              )}
              {monitor.cache_buster && (
                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full">
                  🔄 Cache buster
                </span>
              )}
              {monitor.upside_down && (
                <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/25 px-2 py-0.5 rounded-full">
                  🙃 Upside-down
                </span>
              )}
              {monitor.notify_cert_expiry_days > 0 && (
                <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/25 px-2 py-0.5 rounded-full">
                  🔐 Cert alert ≤ {monitor.notify_cert_expiry_days}d
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupFolderPreview({ items }) {
  // Show up to 9 mini dots representing monitors
  const shown = items.slice(0, 9)
  return (
    <div className="grid grid-cols-3 gap-[3px] w-[38px] h-[38px] p-[5px] rounded-xl bg-white/[0.07] border border-white/[0.08] shrink-0">
      {shown.map(m => {
        const color = m.status === 'up' ? 'bg-green-400' : m.status === 'down' ? 'bg-red-400' : 'bg-yellow-400'
        return <span key={m.id} className={`rounded-sm ${color} opacity-80`} />
      })}
      {/* fill empty cells */}
      {Array.from({ length: Math.max(0, 9 - shown.length) }).map((_, i) => (
        <span key={`e${i}`} className="rounded-sm bg-white/10" />
      ))}
    </div>
  )
}

function GroupSection({ group, isAdmin, allGroups, onToggle, onEdit, onDelete, onAddInGroup, onRenameGroup, onDragStart, onDrop,
  isDraggingGroup, onGroupDragStart, onGroupDragEnd, onGroupDrop }) {
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(group.name)
  const [dragOverId, setDragOverId] = useState(null)
  const [dragOverGroup, setDragOverGroup] = useState(false)
  const [groupDragOverState, setGroupDragOverState] = useState(false)
  const up   = group.items.filter(m => m.status === 'up').length
  const down = group.items.filter(m => m.status === 'down').length
  const allUp = down === 0

  function commitRename() {
    const n = newName.trim()
    if (n && n !== group.name) onRenameGroup(group.name, n)
    setRenaming(false)
  }

  return (
    <div className="mb-8">
      {/* ── Folder header (always visible, clickable to expand/collapse) ── */}
      <div
        className={`relative flex items-center gap-3 mb-3 px-3 py-2.5 rounded-2xl border cursor-pointer select-none transition-all duration-200 ${
          groupDragOverState ? 'ring-2 ring-purple-500/50 bg-purple-500/5' :
          dragOverGroup      ? 'ring-2 ring-indigo-500/50' : ''
        } ${
          collapsed
            ? 'bg-gradient-to-r from-gray-800/80 to-gray-900/60 border-white/[0.08] hover:border-indigo-500/40 hover:from-gray-800 hover:to-gray-900/80'
            : 'bg-gradient-to-r from-gray-900/60 to-black/20 border-white/[0.06]'
        }`}
        onClick={() => setCollapsed(v => !v)}
        onDragOver={e => {
          e.stopPropagation(); e.preventDefault()
          if (isDraggingGroup) { setGroupDragOverState(true); setDragOverGroup(false) }
          else setDragOverGroup(true)
        }}
        onDragLeave={() => { setDragOverGroup(false); setGroupDragOverState(false) }}
        onDrop={e => {
          e.stopPropagation(); e.preventDefault()
          if (isDraggingGroup) { setGroupDragOverState(false); onGroupDrop(group.name) }
          else { setDragOverGroup(false); onDrop(null, group.name) }
        }}
      >
        {/* Group drag handle */}
        <div
          draggable
          onDragStart={e => { e.stopPropagation(); onGroupDragStart(group.name) }}
          onDragEnd={e => { e.stopPropagation(); onGroupDragEnd() }}
          onClick={e => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing shrink-0 w-5 flex flex-col items-center justify-center gap-[3px] py-1 text-gray-700 hover:text-gray-400 transition-colors"
          title="Drag to reorder groups"
        >
          <span className="block w-3 h-px bg-current rounded" />
          <span className="block w-3 h-px bg-current rounded" />
          <span className="block w-3 h-px bg-current rounded" />
        </div>

        {/* Folder icon / mini grid preview when collapsed */}
        {collapsed ? (
          <GroupFolderPreview items={group.items} />
        ) : (
          <div className="w-[38px] h-[38px] flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
            <span className="text-lg">📁</span>
          </div>
        )}

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
              className="bg-transparent border-b border-indigo-500 text-white text-sm font-semibold outline-none pb-0.5 w-40"
            />
          ) : (
            <span className="text-sm font-semibold text-white truncate block">{group.name}</span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {up > 0 && (
              <span className="text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full">
                {up} up
              </span>
            )}
            {down > 0 && (
              <span className="text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full">
                {down} down
              </span>
            )}
            <span className="text-[11px] text-gray-600">{group.items.length} total</span>
          </div>
        </div>

        {/* Status dot + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-2 h-2 rounded-full ${allUp ? 'bg-green-400' : 'bg-red-400'}`} />
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); onAddInGroup(group.name) }}
              title="Add monitor to group"
              className="text-[11px] text-gray-600 hover:text-indigo-400 hover:bg-indigo-400/10 px-2 py-1 rounded-lg transition-all"
            >
              +
            </button>
          )}
          {isAdmin && !renaming && (
            <button
              onClick={e => { e.stopPropagation(); setNewName(group.name); setRenaming(true) }}
              title="Rename group"
              className="text-[11px] text-gray-600 hover:text-gray-300 hover:bg-white/5 px-1.5 py-1 rounded-lg transition-all"
            >
              ✎
            </button>
          )}
          <span className={`text-gray-500 text-xs transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        </div>
      </div>

      {/* ── Cards grid (expand/collapse) ── */}
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {group.items.map(m => (
            <DropletCard
              key={m.id}
              monitor={m}
              isAdmin={isAdmin}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              isDragOver={dragOverId === m.id}
              onDragStart={e => { setDragOverId(null); onDragStart(e, m.id, group.name) }}
              onDragOver={e => { e.preventDefault(); setDragOverId(m.id) }}
              onDrop={e => { e.preventDefault(); setDragOverId(null); onDrop(m.id, group.name) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.is_admin ?? false

  const [monitors, setMonitors] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [modal, setModal]       = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [statusFilter, setStatusFilter] = useState(null)   // 'up' | 'down' | 'paused' | null
  const [isDraggingGroup, setIsDraggingGroup] = useState(false)
  const [groupOrder, setGroupOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sw_group_order') || '[]') } catch { return [] }
  })
  const intervalRef  = useRef(null)
  const dragSrc      = useRef(null)   // { id, groupName }
  const groupDragSrc = useRef(null)   // groupName string

  const load = useCallback(async () => {
    try {
      const data = await monitorsApi.list()
      setMonitors(data)
      setLastRefresh(new Date())
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [load])

  async function handleAdd(body) {
    const created = await monitorsApi.create(body)
    setMonitors(prev => [...prev, created])
  }

  async function handleEdit(id, body) {
    const updated = await monitorsApi.update(id, body)
    setMonitors(prev => prev.map(m => m.id === id ? updated : m))
  }

  async function handleToggle(id, enabled) {
    const updated = await monitorsApi.update(id, { enabled })
    setMonitors(prev => prev.map(m => m.id === id ? updated : m))
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this monitor?')) return
    await monitorsApi.remove(id)
    setMonitors(prev => prev.filter(m => m.id !== id))
  }

  async function handleRenameGroup(oldName, newName) {
    const items = monitors
      .filter(m => m.group_name === oldName)
      .map((m, i) => ({ id: m.id, sort_order: m.sort_order ?? i, group_name: newName }))
    if (!items.length) return
    await monitorsApi.reorder(items)
    setMonitors(prev => prev.map(m => m.group_name === oldName ? { ...m, group_name: newName } : m))
  }

  function handleDragStart(e, id, groupName) {
    dragSrc.current = { id, groupName }
    e.dataTransfer.effectAllowed = 'move'
  }

  async function handleDrop(targetId, targetGroup) {
    const src = dragSrc.current
    if (!src) return
    dragSrc.current = null

    const updated = monitors.map(m => m.id === src.id ? { ...m, group_name: targetGroup } : m)
    const inTarget = updated.filter(m => m.group_name === targetGroup)
    const srcIdx   = inTarget.findIndex(m => m.id === src.id)
    const tgtIdx   = targetId ? inTarget.findIndex(m => m.id === targetId) : inTarget.length - 1

    if (srcIdx !== -1 && tgtIdx !== -1 && srcIdx !== tgtIdx) {
      const [moved] = inTarget.splice(srcIdx, 1)
      inTarget.splice(tgtIdx, 0, moved)
    }

    const reorderItems = inTarget.map((m, i) => ({ id: m.id, sort_order: i, group_name: targetGroup }))
    await monitorsApi.reorder(reorderItems)
    setMonitors(prev => {
      const byId = Object.fromEntries(reorderItems.map(r => [r.id, r]))
      return prev.map(m => byId[m.id] ? { ...m, ...byId[m.id] } : m)
    })
  }

  function handleGroupDragStart(groupName) {
    groupDragSrc.current = groupName
    setIsDraggingGroup(true)
  }

  function handleGroupDragEnd() {
    groupDragSrc.current = null
    setIsDraggingGroup(false)
  }

  function handleGroupDrop(targetGroupName) {
    const src = groupDragSrc.current
    groupDragSrc.current = null
    setIsDraggingGroup(false)
    if (!src || src === targetGroupName) return
    const currentNames = groups.map(g => g.name)
    const srcIdx = currentNames.indexOf(src)
    const tgtIdx = currentNames.indexOf(targetGroupName)
    if (srcIdx === -1 || tgtIdx === -1) return
    const newOrder = [...currentNames]
    const [moved] = newOrder.splice(srcIdx, 1)
    newOrder.splice(tgtIdx, 0, moved)
    setGroupOrder(newOrder)
    try { localStorage.setItem('sw_group_order', JSON.stringify(newOrder)) } catch {}
  }

  const filtered = useMemo(() => {
    let ms = monitors
    if (statusFilter === 'up')     ms = ms.filter(m => m.status === 'up')
    else if (statusFilter === 'down')   ms = ms.filter(m => m.status === 'down')
    else if (statusFilter === 'paused') ms = ms.filter(m => !m.enabled)
    if (search) ms = ms.filter(m =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.url && m.url.toLowerCase().includes(search.toLowerCase()))
    )
    return ms
  }, [monitors, statusFilter, search])

  const groups = useMemo(() => {
    const map = new Map()
    filtered.forEach(m => {
      const g = m.group_name || 'General'
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(m)
    })
    const unsorted = Array.from(map.entries()).map(([name, items]) => ({ name, items }))
    if (!groupOrder.length) return unsorted
    return [...unsorted].sort((a, b) => {
      const ai = groupOrder.indexOf(a.name)
      const bi = groupOrder.indexOf(b.name)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [filtered, groupOrder])

  const allGroupNames = useMemo(
    () => [...new Set(monitors.map(m => m.group_name || 'General'))],
    [monitors]
  )

  const allUp = monitors.length > 0 && monitors.every(m => m.status === 'up' || !m.enabled)

  return (
    <>
      <LiveBackground />
      <div className="relative z-10 max-w-5xl mx-auto">
        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${allUp ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${allUp ? 'bg-green-500' : 'bg-red-500'}`} />
                </span>
                <span className="text-[11px] text-gray-400 uppercase tracking-widest font-medium">
                  {allUp ? 'All Systems Operational' : 'Degraded Performance'}
                </span>
              </div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-300 via-purple-200 to-white bg-clip-text text-transparent">
                Status Monitors
              </h1>
              <p className="text-xs text-gray-500 mt-1">
                HTTP · HTTPS · TCP endpoint health{lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="text-xs text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700 border border-gray-700 px-3 py-1.5 rounded-lg transition-all"
              >
                ↻ Refresh
              </button>
              <button
                onClick={() => setModal('add')}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/20"
              >
                + Add Monitor
              </button>
            </div>
          </div>

          {monitors.length > 2 && (
            <div className="relative mt-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm">🔍</span>
              <input
                type="search"
                placeholder="Search monitors by name or URL…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-gray-900/80 border border-gray-800 focus:border-indigo-500/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none transition-colors"
              />
            </div>
          )}
        </div>

        {monitors.length > 0 && <QuickStats monitors={monitors} activeFilter={statusFilter} onFilter={setStatusFilter} />}

        {error && (
          <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-40 bg-gray-900/60 border border-gray-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
            <div className="text-5xl mb-4">📡</div>
            <p className="text-gray-300 font-semibold mb-2">
              {search ? 'No monitors match your search.' : statusFilter ? `No ${statusFilter} monitors.` : 'No monitors configured yet.'}
            </p>
            {statusFilter && (
              <button onClick={() => setStatusFilter(null)} className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 underline underline-offset-2">Clear filter</button>
            )}
            {!search && !statusFilter && (
              <p className="text-gray-600 text-sm max-w-sm mx-auto">
                Track websites, APIs, and TCP ports. Get instant visibility when anything goes down.
              </p>
            )}
            {!search && !statusFilter && (
              <button
                onClick={() => setModal('add')}
                className="mt-5 inline-flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg font-medium transition-all"
              >
                + Add your first monitor
              </button>
            )}
          </div>
        ) : (
          <div>
            {groups.map(g => (
              <GroupSection
                key={g.name}
                group={g}
                isAdmin={isAdmin}
                allGroups={allGroupNames}
                onToggle={handleToggle}
                onEdit={mon => setModal(mon)}
                onDelete={handleDelete}
                onAddInGroup={gname => setModal({ addGroup: gname })}
                onRenameGroup={handleRenameGroup}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                isDraggingGroup={isDraggingGroup}
                onGroupDragStart={handleGroupDragStart}
                onGroupDragEnd={handleGroupDragEnd}
                onGroupDrop={handleGroupDrop}
              />
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-4 text-xs text-gray-700">
            <span>{filtered.length} monitor{filtered.length !== 1 ? 's' : ''}</span>
            <span>Auto-refreshes every 30s</span>
          </div>
        )}

        {modal === 'add' && (
          <MonitorModal
            defaultGroup="General"
            groups={allGroupNames}
            onSave={handleAdd}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.addGroup !== undefined && (
          <MonitorModal
            defaultGroup={modal.addGroup}
            groups={allGroupNames}
            onSave={handleAdd}
            onClose={() => setModal(null)}
          />
        )}
        {modal && modal !== 'add' && modal?.addGroup === undefined && (
          <MonitorModal
            existing={modal}
            groups={allGroupNames}
            onSave={body => handleEdit(modal.id, body)}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </>
  )
}
