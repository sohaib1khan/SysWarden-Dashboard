import { useState, useCallback } from 'react'
import { fetchApi } from '../api/fetch.js'
import { useKeyStore } from '../store/keyStore.js'

/**
 * Hook for triggering on-demand capability fetches.
 *
 * Returns { run, data, loading, error, reset }.
 * `run(capability, params)` fires a POST to /agents/{id}/fetch.
 * The agent's API key is read from keyStore (set once via the key prompt).
 */
export function useFetch(agentId) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const apiKey                = useKeyStore((s) => s.keys[agentId])

  const run = useCallback(
    async (capability, params = {}) => {
      if (!apiKey) {
        setError('No API key set — enter the agent key below.')
        return
      }
      setLoading(true)
      setError(null)
      setData(null)
      try {
        const resp = await fetchApi.run(agentId, capability, params, apiKey)
        setData(resp.data)
      } catch (err) {
        // 401 means the stored key is wrong — clear it so the prompt reappears
        if (err.message === 'Unauthorized') {
          useKeyStore.getState().clearKey(agentId)
        }
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    [agentId, apiKey],
  )

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { run, data, loading, error, reset }
}
