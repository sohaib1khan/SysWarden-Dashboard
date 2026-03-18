import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Persisted store for agent API keys.
 * Keys survive page reloads via localStorage (sw_agent_keys).
 * Users only need to paste a key once per agent.
 *
 * createJSONStorage is explicit for Zustand v5 compatibility — ensures
 * synchronous localStorage hydration on every mount.
 */
export const useKeyStore = create(
  persist(
    (set) => ({
      keys: {}, // agentId → plaintext key

      setKey: (agentId, key) =>
        set((s) => ({ keys: { ...s.keys, [agentId]: key.trim() } })),

      clearKey: (agentId) =>
        set((s) => {
          const keys = { ...s.keys }
          delete keys[agentId]
          return { keys }
        }),
    }),
    { name: 'sw_agent_keys', storage: createJSONStorage(() => localStorage) },
  ),
)
