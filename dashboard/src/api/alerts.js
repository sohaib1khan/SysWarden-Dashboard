import { api } from './client.js'

export const alertsApi = {
  /** GET /api/v1/alerts/rules?agent_id=... */
  listRules: (agentId) => {
    const qs = agentId ? `?agent_id=${agentId}` : ''
    return api.get(`/api/v1/alerts/rules${qs}`)
  },

  /** POST /api/v1/alerts/rules */
  createRule: (payload) => api.post('/api/v1/alerts/rules', payload),

  /** PATCH /api/v1/alerts/rules/{id}?enabled=true|false */
  toggleRule: (ruleId, enabled) =>
    api.patch(`/api/v1/alerts/rules/${ruleId}?enabled=${enabled}`, {}),

  /** DELETE /api/v1/alerts/rules/{id} */
  deleteRule: (ruleId) => api.delete(`/api/v1/alerts/rules/${ruleId}`),

  /** GET /api/v1/alerts/events?agent_id=...&limit=100 */
  listEvents: (agentId, limit = 100) => {
    const params = new URLSearchParams({ limit })
    if (agentId) params.set('agent_id', agentId)
    return api.get(`/api/v1/alerts/events?${params}`)
  },
}
