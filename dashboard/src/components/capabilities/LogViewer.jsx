import { useState, useMemo } from 'react'
import { Spinner, RunButton } from './shared.jsx'
import { useFetch } from '../../hooks/useFetch.js'

const COMMON_PATHS = [
  '/var/log/syslog',
  '/var/log/auth.log',
  '/var/log/kern.log',
  '/var/log/daemon.log',
  '/var/log/messages',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
  '/var/log/dpkg.log',
  '/var/log/apt/history.log',
]

/**
 * Tail a remote log file with filter/search.
 */
export default function LogViewer({ agentId }) {
  const [path, setPath]         = useState('/var/log/syslog')
  const [lines, setLines]       = useState(100)
  const [filter, setFilter]     = useState('')
  const [showPaths, setShowPaths] = useState(false)
  const { run, data, loading, error } = useFetch(agentId)

  const logLines = data?.lines ?? []

  const filtered = useMemo(() => {
    if (!filter.trim()) return logLines
    const q = filter.toLowerCase()
    return logLines.filter((l) => l.toLowerCase().includes(q))
  }, [logLines, filter])

  const handleRun = () => {
    setFilter('')
    run('sys.logs', { path, lines })
  }

  return (
    <div>
      {/* ── Controls ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 mb-2">
        {/* Path input + quick-select */}
        <div className="flex-1 min-w-0 relative">
          <label className="text-xs text-gray-400 block mb-1">Log file path</label>
          <div className="flex gap-1">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleRun()}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              placeholder="/var/log/syslog"
            />
            <button
              onClick={() => setShowPaths((v) => !v)}
              title="Common log paths"
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs select-none"
            >
              ▾
            </button>
          </div>

          {showPaths && (
            <div className="absolute z-20 left-0 top-full mt-1 w-72 bg-gray-800 border border-gray-700 rounded shadow-xl overflow-hidden">
              {COMMON_PATHS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setPath(p); setShowPaths(false) }}
                  className="block w-full text-left px-3 py-1.5 text-xs font-mono text-gray-300 hover:bg-gray-700"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lines */}
        <div className="w-20">
          <label className="text-xs text-gray-400 block mb-1">Lines</label>
          <input
            type="number"
            value={lines}
            min={1}
            max={1000}
            onChange={(e) => setLines(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <RunButton onClick={handleRun} loading={loading} />
      </div>

      {loading && <Spinner />}

      {/* ── Error ──────────────────────────────────────────────── */}
      {error && (
        <div className="rounded bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 mt-2 space-y-1">
          <div className="font-medium">{error}</div>
          {(error.toLowerCase().includes('permission') || error.toLowerCase().includes('denied')) && (
            <div className="text-xs text-red-400">
              Permission denied — the agent process does not have read access to this file.
              Try running the agent as root (or with <code>sudo</code>), or check file permissions with <code>ls -l {path}</code>.
            </div>
          )}
          {(error.toLowerCase().includes('no such file') || error.toLowerCase().includes('not found')) && (
            <div className="text-xs text-red-400">
              File not found on the remote host. Use the ▾ button to pick a common path, or verify the path exists.
            </div>
          )}
          {(error.includes('502') || error.toLowerCase().includes('bad gateway')) && !error.toLowerCase().includes('permission') && !error.toLowerCase().includes('no such') && (
            <div className="text-xs text-red-400">
              The agent returned an error. Check that the path is correct and the agent has read access.
            </div>
          )}
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────── */}
      {logLines.length > 0 && (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 mt-3 mb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="Filter lines…"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {filtered.length}/{logLines.length} lines
            </span>
            {filter && (
              <button onClick={() => setFilter('')} className="text-xs text-gray-400 hover:text-white">
                ✕
              </button>
            )}
          </div>

          <pre className="bg-gray-900 rounded p-3 text-xs text-green-300 font-mono whitespace-pre-wrap overflow-auto max-h-96 leading-relaxed">
            {filtered.length > 0
              ? filtered.join('\n')
              : <span className="text-gray-500 not-italic">No lines match "{filter}"</span>
            }
          </pre>
        </>
      )}
    </div>
  )
}
