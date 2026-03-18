import { useEffect, useState } from 'react'
import { alertsApi } from '../api/alerts.js'
import { agentsApi } from '../api/agents.js'
import Card from '../components/common/Card.jsx'

const CONDITIONS = [
  { value: 'gt',  label: '> greater than' },
  { value: 'gte', label: '≥ at least' },
  { value: 'lt',  label: '< less than' },
  { value: 'lte', label: '≤ at most' },
]

const COMMON_METRICS = [
  'sys.cpu.percent',
  'sys.mem.percent',
  'sys.disk.percent',
  'sys.mem.used_mb',
  'sys.disk.used_gb',
]

const CONDITION_LABEL = { gt: '>', lt: '<', gte: '≥', lte: '≤' }

function RuleRow({ rule, onDelete, onToggle }) {
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30">
      <td className="py-2 pr-4 font-mono text-xs text-gray-400 truncate max-w-[120px]">{rule.agent_id}</td>
      <td className="py-2 pr-4 text-sm text-white">{rule.metric_name}</td>
      <td className="py-2 pr-4 text-sm text-indigo-300">
        {CONDITION_LABEL[rule.condition]} {rule.threshold}
        {rule.duration_s > 0 && <span className="text-gray-500 text-xs ml-1">for {rule.duration_s}s</span>}
      </td>
      <td className="py-2 pr-4 text-xs text-gray-400 truncate max-w-[160px]">
        {rule.webhook_url
          ? <span className="text-green-400">✓ webhook set</span>
          : <span className="text-gray-600">—</span>}
      </td>
      <td className="py-2 pr-4">
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className={`text-xs px-2 py-0.5 rounded ${
            rule.enabled
              ? 'bg-green-800 text-green-300 hover:bg-green-700'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </td>
      <td className="py-2">
        <button
          onClick={() => onDelete(rule.id)}
          className="text-red-500 hover:text-red-400 text-xs"
        >
          Delete
        </button>
      </td>
    </tr>
  )
}

export default function AlertRules() {
  const [rules, setRules]   = useState([])
  const [agents, setAgents] = useState([])
  const [error, setError]   = useState(null)
  const [form, setForm]     = useState({
    agent_id: '', metric_name: 'sys.cpu.percent',
    condition: 'gt', threshold: '90',
    duration_s: '0', webhook_url: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  const load = () =>
    alertsApi.listRules().then(setRules).catch((e) => setError(e.message))

  useEffect(() => {
    load()
    agentsApi.list().then(setAgents).catch(() => {})
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      await alertsApi.createRule({
        agent_id:    form.agent_id,
        metric_name: form.metric_name,
        condition:   form.condition,
        threshold:   parseFloat(form.threshold),
        duration_s:  parseInt(form.duration_s, 10),
        webhook_url: form.webhook_url || null,
      })
      setForm((f) => ({ ...f, webhook_url: '' }))
      await load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    await alertsApi.deleteRule(id).catch(() => {})
    await load()
  }

  const handleToggle = async (id, enabled) => {
    await alertsApi.toggleRule(id, enabled).catch(() => {})
    await load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Alert Rules</h1>

      {/* Create form */}
      <Card title="New Rule">
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Agent */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Agent</label>
            <select
              required
              value={form.agent_id}
              onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.hostname}</option>
              ))}
            </select>
          </div>

          {/* Metric */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Metric</label>
            <input
              list="metrics-list"
              required
              value={form.metric_name}
              onChange={(e) => setForm((f) => ({ ...f, metric_name: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
            <datalist id="metrics-list">
              {COMMON_METRICS.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>

          {/* Condition */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Condition</label>
            <select
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Threshold */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Threshold</label>
            <input
              type="number"
              required
              step="any"
              value={form.threshold}
              onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Duration (seconds, 0 = instant)</label>
            <input
              type="number"
              min="0"
              max="3600"
              value={form.duration_s}
              onChange={(e) => setForm((f) => ({ ...f, duration_s: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Webhook */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Webhook URL (Slack / Discord / optional)</label>
            <input
              type="url"
              placeholder="https://hooks.slack.com/…"
              value={form.webhook_url}
              onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {saving ? 'Saving…' : 'Create Rule'}
            </button>
            {formError && <span className="text-red-400 text-sm">{formError}</span>}
          </div>
        </form>
      </Card>

      {/* Rules table */}
      <Card title={`Rules (${rules.length})`}>
        {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
        {rules.length === 0 ? (
          <p className="text-gray-500 text-sm">No rules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-700">
                  <th className="pb-2 pr-4">Agent</th>
                  <th className="pb-2 pr-4">Metric</th>
                  <th className="pb-2 pr-4">Condition</th>
                  <th className="pb-2 pr-4">Webhook</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <RuleRow key={r.id} rule={r} onDelete={handleDelete} onToggle={handleToggle} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
