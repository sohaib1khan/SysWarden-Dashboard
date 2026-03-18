import { api } from './client.js'

export const fetchApi = {
  /** GET /api/v1/agents/{id}/capabilities */
  capabilities: (agentId) =>
    api.get(`/api/v1/agents/${agentId}/capabilities`),

  /** POST /api/v1/agents/{id}/fetch — apiKey is the agent's API key */
  run: (agentId, capability, params = {}, apiKey) =>
    api.post(`/api/v1/agents/${agentId}/fetch`, { capability, params }, apiKey),
}
