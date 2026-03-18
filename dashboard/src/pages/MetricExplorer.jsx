import { useState, useEffect, useCallback } from 'react'
import { useAgents } from '../hooks/useAgents.js'
import { metricsApi } from '../api/metrics.js'
import LineChart from '../components/charts/LineChart.jsx'
import Card from '../components/common/Card.jsx'

const RANGES = [
  { label: '15 min',  minutes: 15 },
  { label: '1 hour',  minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '24 hours',minutes: 1440 },
  { label: 'All',     minutes: 0 },
]

const COMMON_METRICS = [
  'sys.cpu.percent',
  'sys.mem.percent',
  'sys.disk.percent',
  'sys.load.1',
  'sys.load.5',
  'sys.net.bytes_sent',
  'sys.net.bytes_recv',
]

export default function MetricExplorer() {
  const { agents } = useAgents()

  const [agentId,  setAgentId]  = useState('')
  const [metric,   setMetric]   = useState('')
  const [range,    setRange]    = useState(60)    // minutes; 0 = all
  const [names,    setNames]    = useState([])
  const [data,     setData]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Load available metric names when agent changes
  useEffect(() => {
    if (!agentId) { setNames([]); setData([]); return }
    metricsApi.listNames(agentId)
      .then(setNames)
      .catch(() => setNames([]))
  }, [agentId])

  const fetchData = useCallback(() => {
    if (!agentId || !metric) return
    setLoading(true)
    setError(null)
    const opts = { limit: 500 }
    if (range > 0) {
      opts.from = new Date(Date.now() - range * 60 * 1000).toISOString()
    }
    metricsApi.query(agentId, metric, opts)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [agentId, metric, range])

  useEffect(() => { fetchData() }, [fetchData])

  const chartData = data.map((p) => ({
    time: new Date(p.timestamp).getTime(),
    value: p.value,
  }))

  const latest = chartData.at(-1)
  const unit = data[0]?.unit ?? ''

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Metric Explorer</h1>

      {/* Controls */}
      <Card className="mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Agent picker */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-xs text-gray-400">Agent</label>
            <select
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm
                         text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:min-w-[180px]"
              value={agentId}
              onChange={(e) => { setAgentId(e.target.value); setMetric(''); setData([]) }}
            >
              <option value="">— select agent —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.hostname}</option>
              ))}
            </select>
          </div>

          {/* Metric picker */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-xs text-gray-400">Metric</label>
            <input
              list="metric-names"
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm
                         text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:min-w-[220px]"
              placeholder="e.g. sys.cpu.percent"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              disabled={!agentId}
            />
            <datalist id="metric-names">
              {(names.length ? names : COMMON_METRICS).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          {/* Time range */}
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-xs text-gray-400">Time range</label>
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRange(r.minutes)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors
                    ${range === r.minutes
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={fetchData}
            disabled={!agentId || !metric}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                       rounded text-sm font-medium transition-colors self-end"
          >
            Refresh
          </button>
        </div>
      </Card>

      {/* Chart area */}
      {!agentId && (
        <p className="text-gray-500 text-sm">Select an agent to get started.</p>
      )}

      {agentId && !metric && (
        <p className="text-gray-500 text-sm">Pick a metric above to plot it.</p>
      )}

      {error && (
        <p className="text-red-400 text-sm">Error: {error}</p>
      )}

      {agentId && metric && !error && (
        <Card
          title={
            <div className="flex items-center justify-between">
              <span>{metric}</span>
              {latest && (
                <span className="text-indigo-300 font-mono text-sm">
                  latest: {latest.value.toFixed(2)}{unit && ` ${unit}`}
                </span>
              )}
            </div>
          }
        >
          {loading && data.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">Loading…</p>
          ) : chartData.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              No data found for this metric in the selected time range.
            </p>
          ) : (
            <LineChart
              data={chartData}
              dataKey="value"
              color="#818cf8"
              unit={unit}
            />
          )}
          <p className="text-xs text-gray-600 mt-2 text-right">{chartData.length} points</p>
        </Card>
      )}
    </div>
  )
}
