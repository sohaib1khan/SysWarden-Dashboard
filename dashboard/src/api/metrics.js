import { api } from './client.js'

export const metricsApi = {
  /** List distinct metric names stored for an agent. */
  listNames: (agentId) =>
    api.get(`/api/v1/metrics/${agentId}/names`),

  /** Query time-series data for an agent + metric + optional time window. */
  query: (agentId, metric, { from, to, limit = 500 } = {}) => {
    const params = new URLSearchParams({ metric, limit })
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    return api.get(`/api/v1/metrics/${agentId}?${params}`)
  },
}
