import { useState } from 'react'
import { Spinner, ErrorBox, RunButton } from './shared.jsx'
import { useFetch } from '../../hooks/useFetch.js'

function statusColor(status) {
  if (!status) return 'text-gray-400'
  const s = status.toLowerCase()
  if (s.includes('up') || s.includes('running')) return 'text-green-400'
  if (s.includes('exit') || s.includes('dead')) return 'text-red-400'
  return 'text-yellow-400'
}

/** Lists containers and optionally tails logs for one */
export default function DockerList({ agentId }) {
  const list = useFetch(agentId)
  const logs = useFetch(agentId)
  const [selectedName, setSelectedName] = useState('')
  const [logLines, setLogLines]         = useState(50)

  return (
    <div className="space-y-4">
      {/* Container list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">All containers (docker ps -a)</span>
          <RunButton onClick={() => list.run('docker.list')} loading={list.loading} label="Refresh" />
        </div>

        {list.loading && <Spinner />}
        {list.error && <ErrorBox message={list.error} />}

        {list.data && (
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="pb-1 pr-3">Name</th>
                <th className="pb-1 pr-3">Image</th>
                <th className="pb-1 pr-3">Status</th>
                <th className="pb-1">Logs</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-1 pr-3 font-mono text-white">{c.name}</td>
                  <td className="py-1 pr-3 text-gray-300 truncate max-w-xs">{c.image}</td>
                  <td className={`py-1 pr-3 ${statusColor(c.status)}`}>{c.status}</td>
                  <td className="py-1">
                    <button
                      onClick={() => setSelectedName(c.name)}
                      className="text-indigo-400 hover:text-indigo-300 text-xs"
                    >
                      Tail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Log tailing section */}
      {selectedName && (
        <div>
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <span className="text-xs text-gray-400 flex-1">
              Logs for <span className="text-white font-mono">{selectedName}</span>
            </span>
            <div className="w-20">
              <label className="text-xs text-gray-400 block mb-1">Lines</label>
              <input
                type="number"
                value={logLines}
                min={1}
                max={500}
                onChange={(e) => setLogLines(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <RunButton
              onClick={() => logs.run('docker.logs', { name: selectedName, lines: logLines })}
              loading={logs.loading}
              label="Fetch Logs"
            />
            <button
              onClick={() => { setSelectedName(''); logs.reset() }}
              className="text-gray-500 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
          {logs.loading && <Spinner />}
          {logs.error && <ErrorBox message={logs.error} />}
          {logs.data && (
            <pre className="bg-gray-900 rounded p-3 text-xs text-green-300 font-mono whitespace-pre-wrap overflow-auto max-h-64">
              {Array.isArray(logs.data) ? logs.data.join('\n') : String(logs.data)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
