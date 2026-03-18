import { Spinner, ErrorBox, RunButton } from './shared.jsx'
import { useFetch } from '../../hooks/useFetch.js'

/**
 * Shows top processes on the agent, sorted by CPU %.
 * params: { limit: 20 }
 */
export default function ProcessList({ agentId }) {
  const { run, data, loading, error } = useFetch(agentId)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">Top processes by CPU</span>
        <RunButton onClick={() => run('sys.processes', { limit: 20 })} loading={loading} />
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="pb-1 pr-4">PID</th>
                <th className="pb-1 pr-4">Name</th>
                <th className="pb-1 pr-4">CPU %</th>
                <th className="pb-1 pr-4">Mem MB</th>
                <th className="pb-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.pid} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-1 pr-4 font-mono text-gray-400">{p.pid}</td>
                  <td className="py-1 pr-4 font-medium text-white">{p.name}</td>
                  <td className="py-1 pr-4 text-indigo-300">{p.cpu_pct}%</td>
                  <td className="py-1 pr-4 text-gray-300">{p.mem_mb}</td>
                  <td className="py-1 text-gray-400">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
