import { useEffect, useRef } from 'react'
import { useAgentStore } from '../store/agentStore.js'

/**
 * Poll the agents list every `interval` ms.
 * Stores results in Zustand — components just read the store.
 */
export function useAgents(interval = 10_000) {
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const calledOnce = useRef(false)

  useEffect(() => {
    if (!calledOnce.current) {
      fetchAgents()
      calledOnce.current = true
    }
    const id = setInterval(fetchAgents, interval)
    return () => clearInterval(id)
  }, [fetchAgents, interval])

  return {
    agents:  useAgentStore((s) => s.agents),
    loading: useAgentStore((s) => s.loading),
    error:   useAgentStore((s) => s.error),
  }
}
