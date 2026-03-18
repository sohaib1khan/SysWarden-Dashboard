import { create } from 'zustand'
import { agentsApi } from '../api/agents.js'

export const useAgentStore = create((set) => ({
  agents: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null })
    try {
      const agents = await agentsApi.list()
      set({ agents, loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },
}))
