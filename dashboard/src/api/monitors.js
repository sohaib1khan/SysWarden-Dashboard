import { api } from './client.js'

export const monitorsApi = {
  list:        ()              => api.get('/api/v1/monitors'),
  get:         (id)            => api.get(`/api/v1/monitors/${id}`),
  create:      (body)          => api.post('/api/v1/monitors', body),
  update:      (id, body)      => api.patch(`/api/v1/monitors/${id}`, body),
  remove:      (id)            => api.delete(`/api/v1/monitors/${id}`),
  events:      (id, limit = 90) => api.get(`/api/v1/monitors/${id}/events?limit=${limit}`),
  reorder:     (items)         => api.post('/api/v1/monitors/reorder', items),
}
