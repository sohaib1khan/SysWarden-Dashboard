import { api } from './client.js'

export const pluginsApi = {
  list:         (agentId) => api.get('/api/v1/plugins' + (agentId ? `?agent_id=${agentId}` : '')),
  get:          (id)      => api.get(`/api/v1/plugins/${id}`),
  setEnabled:   (id, enabled) => api.patch(`/api/v1/plugins/${id}`, { enabled }),
  remove:       (id)      => api.delete(`/api/v1/plugins/${id}`),
}

export const pluginStoreApi = {
  list:   ()           => api.get('/api/v1/plugin-store'),
  get:    (name)       => api.get(`/api/v1/plugin-store/${name}`),
  create: (body)       => api.post('/api/v1/plugin-store', body),
  update: (name, body) => api.patch(`/api/v1/plugin-store/${name}`, body),
  remove: (name)       => api.delete(`/api/v1/plugin-store/${name}`),
}
