import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'

/**
 * CRUD hook for server-persisted agent API keys.
 *
 * Keys are stored on the backend (behind JWT auth) so they survive
 * across different browsers/devices. The hook also exposes:
 *  - testKey(keyId) → { valid }
 *  - rotateKey()    → generates a new key, pushes it to the agent via
 *                     WebSocket (if online), and returns the plaintext key
 */
export function useAgentKeys(agentId) {
  const token = useAuthStore((s) => s.token)
  const [keys, setKeys]       = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const refresh = useCallback(async () => {
    if (!agentId || !token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/keys`, {
        headers: authHeaders,
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      setKeys(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, token])

  useEffect(() => { refresh() }, [refresh])

  /**
   * Save a plaintext key to the server (verifies against agent hash first).
   * Returns the saved AgentKeyOut record.
   */
  const saveKey = async (key, label = 'default') => {
    const res = await fetch(`/api/v1/agents/${agentId}/keys`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ key, label }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
    await refresh()
    return body
  }

  /** Delete a saved key by its server-side id. */
  const deleteKey = async (keyId) => {
    const res = await fetch(`/api/v1/agents/${agentId}/keys/${keyId}`, {
      method: 'DELETE',
      headers: authHeaders,
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.detail || `HTTP ${res.status}`)
    }
    await refresh()
  }

  /**
   * Test a saved key — returns { valid: bool }.
   * Updates verified_at on the server when valid.
   */
  const testKey = async (keyId) => {
    const res = await fetch(`/api/v1/agents/${agentId}/keys/${keyId}/test`, {
      method: 'POST',
      headers: authHeaders,
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
    await refresh()   // refresh to pick up updated verified_at
    return body
  }

  /**
   * Rotate the agent's key.
   * Backend generates a new key, pushes it to the agent via WS (if online),
   * and returns the new plaintext key.  Returns { api_key, pushed_to_agent }.
   */
  const rotateKey = async () => {
    const res = await fetch(`/api/v1/agents/${agentId}/rotate-key`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'default' }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`)
    await refresh()
    return body   // { agent_id, api_key, pushed_to_agent, key_id }
  }

  return { keys, loading, error, refresh, saveKey, deleteKey, testKey, rotateKey }
}
