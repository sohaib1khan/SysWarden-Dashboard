import { useState, useEffect, useCallback } from 'react'
import { agentsApi } from '../api/agents.js'
import Card from '../components/common/Card.jsx'
import StatusBadge from '../components/charts/StatusBadge.jsx'
import AgentDownloadModal from '../components/agents/AgentDownloadModal.jsx'

function timeAgo(ts) {
  if (!ts) return 'never'
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function RenameModal({ agent, onClose, onSaved }) {
  const [hostname, setHostname] = useState(agent.hostname)
  const [apiKey,   setApiKey]   = useState('')
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await agentsApi.rename(agent.id, hostname.trim(), apiKey.trim())
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-8 overflow-y-auto">
      <Card className="w-full max-w-md max-h-full">
        <h2 className="text-lg font-semibold mb-4">Rename agent</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">New hostname label</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white
                         focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Agent API key (line 2 of agent.key)</label>
            <input
              type="password"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white
                         focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 rounded bg-gray-700 text-sm hover:bg-gray-600 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-medium
                         disabled:opacity-40 transition-colors">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function DeleteModal({ agent, onClose, onDeleted }) {
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(false)

  async function confirm() {
    setError(null)
    setBusy(true)
    try {
      await agentsApi.remove(agent.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-8 overflow-y-auto">
      <Card className="w-full max-w-md max-h-full">
        <h2 className="text-lg font-semibold mb-2 text-red-400">Remove agent</h2>
        <p className="text-sm text-gray-400 mb-4">
          This will permanently delete <span className="text-white font-medium">{agent.hostname}</span> and
          all its stored metrics and alert rules. This cannot be undone.
        </p>
        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 rounded bg-gray-700 text-sm hover:bg-gray-600 transition-colors">
            Cancel
          </button>
          <button onClick={confirm} disabled={busy}
            className="px-4 py-1.5 rounded bg-red-700 hover:bg-red-600 text-sm font-medium
                       disabled:opacity-40 transition-colors">
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Card>
    </div>
  )
}

export default function AgentManager() {
  const [agents,  setAgents]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [renaming,      setRenaming]      = useState(null)   // agent being renamed
  const [deleting,      setDeleting]      = useState(null)   // agent being deleted
  const [showDownload,  setShowDownload]  = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    agentsApi.list()
      .then(setAgents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && agents.length === 0) {
    return <p className="text-gray-500 mt-8 text-center">Loading…</p>
  }
  if (error) {
    return <p className="text-red-400 mt-8 text-center">Error: {error}</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agent Manager</h1>
        <button
          onClick={() => setShowDownload(true)}
          className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500
                     text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          📥 Get Agent
        </button>
      </div>

      {showDownload && <AgentDownloadModal onClose={() => setShowDownload(false)} />}

      {agents.length === 0 ? (
        <p className="text-gray-500">No agents registered yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Hostname</th>
                <th className="pb-2 pr-4 font-medium">Agent ID</th>
                <th className="pb-2 pr-4 font-medium">Capabilities</th>
                <th className="pb-2 pr-4 font-medium">Last seen</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 pr-4"><StatusBadge online={a.online} /></td>
                  <td className="py-3 pr-4 font-medium text-white">{a.hostname}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-500">{a.id}</td>
                  <td className="py-3 pr-4 text-gray-400">
                    {a.capabilities?.length ?? 0} caps
                  </td>
                  <td className="py-3 pr-4 text-gray-400">{timeAgo(a.last_seen)}</td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setRenaming(a)}
                        className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => setDeleting(a)}
                        className="px-3 py-1 text-xs rounded bg-red-900/60 hover:bg-red-800 text-red-300
                                   transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {renaming && (
        <RenameModal
          agent={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => { setRenaming(null); load() }}
        />
      )}
      {deleting && (
        <DeleteModal
          agent={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}
