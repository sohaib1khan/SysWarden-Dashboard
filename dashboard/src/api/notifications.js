import { api } from './client.js'

export const notificationsApi = {
  list:   ()          => api.get('/api/v1/notifications/channels'),
  create: (body)      => api.post('/api/v1/notifications/channels', body),
  update: (id, body)  => api.patch(`/api/v1/notifications/channels/${id}`, body),
  remove: (id)        => api.delete(`/api/v1/notifications/channels/${id}`),
  test:   (id)        => api.post(`/api/v1/notifications/channels/${id}/test`),
}
