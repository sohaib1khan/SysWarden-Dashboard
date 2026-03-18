import { api } from './client.js'

export const agentsApi = {
  list:   ()                   => api.get('/api/v1/agents'),
  get:    (id)                 => api.get(`/api/v1/agents/${id}`),
  rename: (id, hostname, key)  => api.patch(`/api/v1/agents/${id}`, { hostname }, key),
  remove: (id)                 => api.delete(`/api/v1/agents/${id}`),
}
