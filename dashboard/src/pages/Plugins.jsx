import { useEffect, useState, useCallback } from 'react'
import { pluginsApi, pluginStoreApi } from '../api/plugins.js'
import { useAuthStore } from '../store/authStore.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatLastSeen(ts) {
  if (!ts) return 'Never'
  const d = new Date(ts + 'Z')
  const diffS = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffS < 60)  return `${diffS}s ago`
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`
  return `${Math.floor(diffS / 3600)}h ago`
}

function formatInterval(secs) {
  if (secs < 60) return `every ${secs}s`
  if (secs < 3600) return `every ${Math.floor(secs / 60)}m`
  return `every ${Math.floor(secs / 3600)}h`
}

// ── sub-components ────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-40 ${
        enabled ? 'bg-indigo-600' : 'bg-gray-600'
      }`}
      aria-label={enabled ? 'Disable plugin' : 'Enable plugin'}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function PluginRow({ plugin, isAdmin, onToggle, onDelete }) {
  const [toggling, setToggling] = useState(false)

  async function handleToggle(val) {
    setToggling(true)
    await onToggle(plugin.id, val)
    setToggling(false)
  }

  return (
    <div className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
      plugin.enabled
        ? 'bg-gray-800/50 border-gray-700'
        : 'bg-gray-900/30 border-gray-800 opacity-60'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-100 text-sm">{plugin.name}</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">
            v{plugin.version}
          </span>
          {plugin.author && (
            <span className="text-xs text-gray-600">by {plugin.author}</span>
          )}
        </div>
        {plugin.description && (
          <p className="text-xs text-gray-400 mt-1">{plugin.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
          <span>⏱ {formatInterval(plugin.interval_seconds)}</span>
          <span>🕐 {formatLastSeen(plugin.last_seen)}</span>
          {plugin.output_schema && plugin.output_schema !== '{}' && (
            <span className="font-mono text-gray-600 truncate max-w-xs" title={plugin.output_schema}>
              schema: {plugin.output_schema}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <Toggle enabled={plugin.enabled} onChange={handleToggle} disabled={toggling} />
        {isAdmin && (
          <button
            onClick={() => onDelete(plugin.id)}
            className="text-gray-600 hover:text-red-400 transition-colors text-sm"
            title="Remove from registry"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

function AgentSection({ agentId, plugins, isAdmin, onToggle, onDelete }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Agent
        </span>
        <code className="text-xs text-indigo-400 bg-gray-800 px-2 py-0.5 rounded">
          {agentId}
        </code>
        <span className="text-xs text-gray-600">({plugins.length} plugin{plugins.length !== 1 ? 's' : ''})</span>
      </div>
      <div className="space-y-2">
        {plugins.map((p) => (
          <PluginRow
            key={p.id}
            plugin={p}
            isAdmin={isAdmin}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}

// ── Plugin Store modal ────────────────────────────────────────────────────────

const BLANK_FORM = {
  name: '', description: '', script: '#!/bin/bash\n# PLUGIN_NAME: my_plugin\n# PLUGIN_VERSION: 1.0.0\n# PLUGIN_DESCRIPTION:\n# PLUGIN_TYPE: metric\n',
  version: '1.0.0', plugin_type: 'metric', capability_name: '', enabled: true,
}

function StoreModal({ initial, onSave, onClose }) {
  const isEdit = !!initial
  const [form, setForm] = useState(initial ?? BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      const body = { ...form }
      if (body.plugin_type !== 'capability') body.capability_name = null
      await onSave(body)
      onClose()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? `Edit — ${initial.name}` : 'New Plugin Script'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded px-3 py-2">{err}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name *</label>
              <input
                required
                disabled={isEdit}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="my_plugin"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Version</label>
              <input
                value={form.version}
                onChange={(e) => set('version', e.target.value)}
                placeholder="1.0.0"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Brief description of what this plugin does"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <select
                value={form.plugin_type}
                onChange={(e) => set('plugin_type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="metric">metric — scheduled, pushes metrics</option>
                <option value="capability">capability — on-demand handler</option>
              </select>
            </div>
            {form.plugin_type === 'capability' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Capability Name *</label>
                <input
                  required={form.plugin_type === 'capability'}
                  value={form.capability_name}
                  onChange={(e) => set('capability_name', e.target.value)}
                  placeholder="custom.my_check"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Toggle enabled={form.enabled} onChange={(v) => set('enabled', v)} />
            <span className="text-xs text-gray-400">Enabled (agents will download this script)</span>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Script *</label>
            <textarea
              required
              value={form.script}
              onChange={(e) => set('script', e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-xs text-green-300 font-mono placeholder-gray-700 focus:outline-none focus:border-indigo-500 resize-y"
            />
          </div>
        </form>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Script')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Plugin Store tab ──────────────────────────────────────────────────────────

function PluginStore({ isAdmin }) {
  const [scripts, setScripts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // null | { mode: 'create' } | { mode: 'edit', script }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await pluginStoreApi.list()
      setScripts(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(body) {
    if (modal?.mode === 'edit') {
      const updated = await pluginStoreApi.update(modal.script.name, body)
      setScripts((prev) => prev.map((s) => (s.name === updated.name ? updated : s)))
    } else {
      const created = await pluginStoreApi.create(body)
      setScripts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    }
  }

  async function handleToggle(name, enabled) {
    try {
      const updated = await pluginStoreApi.update(name, { enabled })
      setScripts((prev) => prev.map((s) => (s.name === name ? updated : s)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete plugin script "${name}"? Agents will stop syncing it on the next poll.`)) return
    try {
      await pluginStoreApi.remove(name)
      setScripts((prev) => prev.filter((s) => s.name !== name))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      {modal && (
        <StoreModal
          initial={modal.mode === 'edit' ? modal.script : null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-500">
          Scripts stored here are automatically synced to agents every 60 s — no redeploy needed.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors bg-gray-800 px-3 py-1.5 rounded-md"
          >
            ↻ Refresh
          </button>
          {isAdmin && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-md transition-colors"
            >
              + New Script
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 text-sm py-12">Loading…</div>
      ) : scripts.length === 0 ? (
        <div className="text-center text-gray-600 text-sm py-12">
          No backend scripts yet.{' '}
          {isAdmin && (
            <button onClick={() => setModal({ mode: 'create' })} className="text-indigo-400 hover:underline">
              Create the first one.
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {scripts.map((s) => (
            <div
              key={s.name}
              className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                s.enabled ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-900/30 border-gray-800 opacity-60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-100 text-sm">{s.name}</span>
                  <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">
                    v{s.version}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    s.plugin_type === 'capability'
                      ? 'bg-cyan-900/50 text-cyan-300'
                      : 'bg-indigo-900/50 text-indigo-300'
                  }`}>
                    {s.plugin_type}
                  </span>
                  {s.capability_name && (
                    <code className="text-xs text-yellow-400 bg-gray-800 px-1.5 py-0.5 rounded">
                      {s.capability_name}
                    </code>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-gray-400 mt-1">{s.description}</p>
                )}
                <div className="text-xs text-gray-600 mt-1 font-mono">
                  sha256: {s.checksum.slice(0, 16)}…
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Toggle enabled={s.enabled} onChange={(v) => handleToggle(s.name, v)} />
                {isAdmin && (
                  <>
                    <button
                      onClick={() => setModal({ mode: 'edit', script: s })}
                      className="text-gray-500 hover:text-indigo-400 transition-colors text-sm"
                      title="Edit script"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(s.name)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-sm"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && scripts.length > 0 && (
        <div className="text-xs text-gray-600 text-right">
          {scripts.length} script{scripts.length !== 1 ? 's' : ''} ·{' '}
          {scripts.filter((s) => s.enabled).length} enabled
        </div>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Plugins() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState(0)
  const [plugins, setPlugins]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error,   setError  ]   = useState('')
  const [search,  setSearch ]   = useState('')

  const isAdmin = user?.is_admin ?? false

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await pluginsApi.list()
      setPlugins(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleToggle(id, enabled) {
    try {
      const updated = await pluginsApi.setEnabled(id, enabled)
      setPlugins((prev) => prev.map((p) => (p.id === id ? updated : p)))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this plugin from the registry?')) return
    try {
      await pluginsApi.remove(id)
      setPlugins((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  const filtered = search
    ? plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase())
      )
    : plugins

  const byAgent = filtered.reduce((acc, p) => {
    if (!acc[p.agent_id]) acc[p.agent_id] = []
    acc[p.agent_id].push(p)
    return acc
  }, {})

  const TABS = ['Agent Plugins', 'Plugin Store']

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-100">Plugins</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Manage agent-discovered scripts and backend-distributed plugin store
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((label, i) => (
          <button
            key={label}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === i
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 0 — Agent Plugins */}
      {activeTab === 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-500">
              Scripts discovered in each agent's <code className="text-indigo-400">./plugins/</code> directory
            </p>
            <button
              onClick={load}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors bg-gray-800 px-3 py-1.5 rounded-md"
            >
              ↻ Refresh
            </button>
          </div>

          <input
            type="search"
            placeholder="Search plugins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />

          <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-lg px-4 py-3 text-xs text-indigo-300 space-y-1">
            <div className="font-semibold text-indigo-200">How to add a local plugin</div>
            <div>1. Drop an executable script into <code className="bg-indigo-900/50 px-1 rounded">./plugins/</code> on the agent host</div>
            <div>2. Add manifest comments at the top: <code className="bg-indigo-900/50 px-1 rounded"># PLUGIN_NAME: my_check</code></div>
            <div>3. Print a JSON metric array to stdout and restart the agent — it appears here automatically</div>
          </div>

          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-500 text-sm py-12">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-600 text-sm py-12">
              {search ? 'No plugins match your search.' : 'No plugins discovered yet. Deploy an agent with scripts in ./plugins/'}
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(byAgent).map(([agentId, agentPlugins]) => (
                <AgentSection
                  key={agentId}
                  agentId={agentId}
                  plugins={agentPlugins}
                  isAdmin={isAdmin}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="text-xs text-gray-600 text-right">
              {filtered.length} plugin{filtered.length !== 1 ? 's' : ''} across {Object.keys(byAgent).length} agent{Object.keys(byAgent).length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Tab 1 — Plugin Store */}
      {activeTab === 1 && <PluginStore isAdmin={isAdmin} />}
    </div>
  )
}

