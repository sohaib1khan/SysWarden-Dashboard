import { useEffect, useState } from 'react'
import { alertsApi } from '../api/alerts.js'
import { agentsApi } from '../api/agents.js'
import Card from '../components/common/Card.jsx'

const CONDITION_LABEL = { gt: '>', lt: '<', gte: '≥', lte: '≤' }

function severityColor(condition, value, threshold) {
  const ratio = condition === 'lt' || condition === 'lte'
    ? threshold / Math.max(value, 0.01)
    : value / Math.max(threshold, 0.01)
  if (ratio >= 1.5) return 'text-red-400'
  if (ratio >= 1.1) return 'text-yellow-400'
  return 'text-orange-400'
}

export default function IncidentLog() {
  const [events, setEvents]   = useState([])
  const [agents, setAgents]   = useState([])
  const [filter, setFilter]   = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = async (agentId) => {
    setLoading(true)
    try {
      const data = await alertsApi.listEvents(agentId || undefined, 200)
      setEvents(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    agentsApi.list().then(setAgents).catch(() => {})
    const id = setInterval(() => load(filter), 30_000)
    return () => clearInterval(id)
  }, [])

  const handleFilter = (agentId) => {
    setFilter(agentId)
    load(agentId)
  }

  const agentName = (id) => agents.find((a) => a.id === id)?.hostname ?? id

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Incident Log</h1>
        <select
          value={filter}
          onChange={(e) => handleFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.hostname}</option>)}
        </select>
      </div>

      <Card title={`Events (${events.length})`}>
        {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
        {loading && events.length === 0 && (
          <p className="text-gray-500 text-sm">Loading…</p>
        )}
        {!loading && events.length === 0 && (
          <p className="text-gray-500 text-sm">No incidents recorded yet.</p>
        )}
        {events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-700">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Agent</th>
                  <th className="pb-2 pr-4">Metric</th>
                  <th className="pb-2 pr-4">Value</th>
                  <th className="pb-2 pr-4">Condition</th>
                  <th className="pb-2">Notified</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                    <td className="py-2 pr-4 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(ev.fired_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-sm text-white">{agentName(ev.agent_id)}</td>
                    <td className="py-2 pr-4 text-sm font-mono text-gray-300">{ev.metric_name}</td>
                    <td className={`py-2 pr-4 font-bold ${severityColor(ev.condition, ev.value, ev.threshold)}`}>
                      {ev.value}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-400">
                      {CONDITION_LABEL[ev.condition]} {ev.threshold}
                    </td>
                    <td className="py-2">
                      {ev.notified
                        ? <span className="text-green-400 text-xs">✓ sent</span>
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
