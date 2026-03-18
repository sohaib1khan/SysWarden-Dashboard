import { api } from './client.js'

export const authApi = {
  setup:      ()              => api.get('/api/v1/auth/setup'),
  register:   (username, pw)  => api.post('/api/v1/auth/register', { username, password: pw }),
  login:      (username, pw)  => api.post('/api/v1/auth/login',    { username, password: pw }),
  logout:     ()              => api.post('/api/v1/auth/logout'),
  refresh:    ()              => api.post('/api/v1/auth/refresh'),
  me:         ()              => api.get('/api/v1/auth/me'),
  updateMe:   (data)          => api.patch('/api/v1/auth/me', data),
  listUsers:  ()              => api.get('/api/v1/auth/users'),
  createUser: (data)          => api.post('/api/v1/auth/users', data),
  updateUser: (id, data)      => api.patch(`/api/v1/auth/users/${id}`, data),
  deleteUser: (id)            => api.delete(`/api/v1/auth/users/${id}`),
}
