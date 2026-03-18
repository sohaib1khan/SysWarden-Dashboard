import { useState } from 'react'
import { Spinner, ErrorBox, RunButton } from './shared.jsx'
import { useFetch } from '../../hooks/useFetch.js'

/**
 * TCP reachability checks from the agent.
 * params: { targets: ['host:port', ...] }
 */
export default function NetworkCheck({ agentId }) {
  const [raw, setRaw] = useState('8.8.8.8:53\ngoogle.com:443')
  const { run, data, loading, error } = useFetch(agentId)

  const targets = raw
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)

  return (
    <div>
      <div className="flex flex-col gap-2 mb-3">
        <label className="text-xs text-gray-400">
          Targets — one <code className="text-indigo-300">host:port</code> per line
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 resize-none"
        />
        <div className="flex justify-end">
          <RunButton
            onClick={() => run('sys.network', { targets })}
            loading={loading}
            label="Check"
          />
        </div>
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}

      {data && (
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="pb-1 pr-4">Target</th>
              <th className="pb-1 pr-4">Reachable</th>
              <th className="pb-1">Latency</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.target} className="border-b border-gray-800">
                <td className="py-1 pr-4 font-mono text-gray-300">{r.target}</td>
                <td className="py-1 pr-4">
                  {r.reachable ? (
                    <span className="text-green-400">✓ Yes</span>
                  ) : (
                    <span className="text-red-400">✗ No</span>
                  )}
                </td>
                <td className="py-1 text-gray-400">
                  {r.latency_ms != null ? `${r.latency_ms} ms` : r.error ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
