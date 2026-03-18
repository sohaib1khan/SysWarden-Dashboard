import { useState } from 'react'
import { useAgentKeys } from '../../hooks/useAgentKeys.js'
import { useKeyStore } from '../../store/keyStore.js'

/**
 * KeyManager — dropdown panel for server-persisted agent API keys.
 *
 * Features:
 *  • Lists all keys saved to the backend (survives across browsers/devices)
 *  • Test  — verifies a key against the agent's stored hash
 *  • Activate — loads key into local keyStore so capability calls work
 *  • Delete — removes key from server
 *  • Add key — paste a new key and save it to the server (validates first)
 *  • Auto-configure — rotates the agent's key, pushes new key to the agent
 *    over WebSocket (no manual agent-side intervention needed), and auto-saves
 */
export default function KeyManager({ agentId, agentOnline }) {
  const { keys, loading, error, saveKey, deleteKey, testKey, rotateKey, refresh } =
    useAgentKeys(agentId)
  const { keys: localKeys, setKey: setLocalKey, clearKey } = useKeyStore()
  const activeKey = localKeys[agentId]

  const [open, setOpen]         = useState(false)
  const [draft, setDraft]       = useState('')
  const [draftLabel, setLabel]  = useState('default')
  const [busy, setBusy]         = useState(null)    // keyId | 'add' | 'rotate' | null
  const [testResults, setTests] = useState({})      // keyId → true/false/null
  const [feedback, setFeedback] = useState(null)    // { type: 'ok'|'err', msg }

  // Auto-activate the first verified server key if no local key is set
  if (!activeKey && keys.length > 0) {
    const first = keys[0]
    // We don't have the full plaintext from the list endpoint (only preview)
    // — must use rotate or manual add to get a usable key
  }

  const toast = (type, msg) => {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 4000)
  }

  const handleTest = async (keyId) => {
    setBusy(keyId)
    try {
      const { valid } = await testKey(keyId)
      setTests((t) => ({ ...t, [keyId]: valid }))
      toast(valid ? 'ok' : 'err', valid ? '✓ Key is valid' : '✗ Key mismatch — hash changed?')
    } catch (e) {
      toast('err', e.message)
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (keyId) => {
    if (!window.confirm('Remove this saved key?')) return
    setBusy(keyId)
    try {
      await deleteKey(keyId)
      setTests((t) => { const n = { ...t }; delete n[keyId]; return n })
      // If this was the local active key, clear it
      clearKey(agentId)
      toast('ok', 'Key deleted')
    } catch (e) {
      toast('err', e.message)
    } finally {
      setBusy(null)
    }
  }

  const handleAdd = async () => {
    if (!draft.trim()) return
    setBusy('add')
    try {
      await saveKey(draft.trim(), draftLabel || 'default')
      setDraft('')
      setLabel('default')
      toast('ok', '✓ Key saved and verified')
    } catch (e) {
      toast('err', e.message)
    } finally {
      setBusy(null)
    }
  }

  const handleRotate = async () => {
    if (
      !window.confirm(
        agentOnline
          ? 'Generate a new API key? The new key will be pushed to the agent automatically.'
          : 'Agent is offline. Generate a new key anyway? You will need to manually update the agent keyfile.',
      )
    )
      return
    setBusy('rotate')
    try {
      const { api_key, pushed_to_agent } = await rotateKey()
      // Auto-save new key into local store so capabilities work immediately
      setLocalKey(agentId, api_key)
      toast(
        'ok',
        pushed_to_agent
          ? '✓ New key generated and pushed to agent automatically'
          : `✓ New key generated. Agent was offline — update ${String.fromCodePoint(0x7e)}/.syswarden/agent.key manually`,
      )
    } catch (e) {
      toast('err', e.message)
    } finally {
      setBusy(null)
    }
  }

  // ── Trigger icon / label ─────────────────────────────────────────────────
  const statusDot = activeKey
    ? 'bg-green-500'
    : keys.length > 0
    ? 'bg-yellow-400'
    : 'bg-gray-600'

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800 border border-gray-700 hover:border-gray-500 text-sm text-gray-200 transition-colors"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
        API Keys
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-40 right-0 mt-2 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-white">Saved API Keys</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Stored server-side — available on any device
              </p>
            </div>
            <button
              onClick={handleRotate}
              disabled={busy === 'rotate'}
              title={
                agentOnline
                  ? 'Auto-configure: generate new key and push to agent'
                  : 'Generate new key (agent offline — manual update required)'
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                agentOnline
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              } disabled:opacity-50`}
            >
              {busy === 'rotate' ? (
                <Spinner />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {agentOnline ? 'Auto-configure' : 'Rotate key'}
            </button>
          </div>

          {/* Feedback toast */}
          {feedback && (
            <div
              className={`mx-4 mt-3 px-3 py-2 rounded text-xs ${
                feedback.type === 'ok'
                  ? 'bg-green-900/60 text-green-300'
                  : 'bg-red-900/60 text-red-300'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {/* Saved keys list */}
          <div className="px-4 py-3 max-h-56 overflow-y-auto space-y-2">
            {loading && (
              <p className="text-xs text-gray-500 py-2">Loading…</p>
            )}
            {!loading && error && (
              <p className="text-xs text-red-400 py-2">{error}</p>
            )}
            {!loading && !error && keys.length === 0 && (
              <p className="text-xs text-gray-500 py-2 text-center">
                No saved keys yet — add one below or use Auto-configure
              </p>
            )}
            {keys.map((k) => {
              const isActive = activeKey != null  // we can't compare preview to full key
              const testResult = testResults[k.id]
              return (
                <div
                  key={k.id}
                  className="flex items-center gap-2 py-2 border-b border-gray-800 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-200 truncate">
                        {k.key_preview}
                      </span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                        {k.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex gap-2">
                      <span>Added {formatDate(k.created_at)}</span>
                      {k.verified_at && (
                        <span className="text-green-500">✓ verified {formatDate(k.verified_at)}</span>
                      )}
                      {testResult === false && (
                        <span className="text-red-400">✗ invalid</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleTest(k.id)}
                      disabled={busy === k.id}
                      className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50 transition-colors"
                    >
                      {busy === k.id ? <Spinner /> : 'Test'}
                    </button>
                    <button
                      onClick={() => handleDelete(k.id)}
                      disabled={busy === k.id}
                      className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-red-900 text-gray-300 hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Active key status */}
          {activeKey && (
            <div className="mx-4 mb-3 px-3 py-2 rounded bg-green-900/30 border border-green-700/40 flex items-center justify-between">
              <span className="text-xs text-green-300">
                ✓ Active key loaded (capability calls will use this key)
              </span>
              <button
                onClick={() => clearKey(agentId)}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors ml-2"
              >
                Clear
              </button>
            </div>
          )}

          {/* Add key form */}
          <div className="px-4 pb-4 border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-400 mb-2">
              Paste a key manually{' '}
              <span className="text-gray-500">(line 2 of ~/.syswarden/agent.key)</span>
            </p>
            <div className="flex flex-col gap-2">
              <input
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="wSIDhvK-Ql7rRlObMm…"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="label (e.g. default)"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleAdd}
                  disabled={!draft.trim() || busy === 'add'}
                  className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-1"
                >
                  {busy === 'add' ? <Spinner /> : 'Save'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              Key will be verified against the agent before saving.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const now = new Date()
  const diffS = Math.floor((now - d) / 1000)
  if (diffS < 60) return 'just now'
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`
  return d.toLocaleDateString()
}
