// Base API client — all requests go through here.
// The dev proxy in vite.config.js forwards /api to the backend,
// so no hardcoded URLs are needed. In production, set VITE_API_BASE
// to the backend's public URL.

const BASE = import.meta.env.VITE_API_BASE || ''

// Lazy import avoids circular deps (authStore imports nothing from api/)
function getToken() {
  return localStorage.getItem('sw_token') || null
}

async function request(method, path, body, apiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-Api-Key'] = apiKey
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',  // send HttpOnly refresh cookie
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail || `HTTP ${res.status}`)
  }

  // 204 No Content — nothing to parse
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get:    (path)              => request('GET',    path),
  post:   (path, body, key)   => request('POST',   path, body, key),
  patch:  (path, body, key)   => request('PATCH',  path, body, key),
  delete: (path, key)         => request('DELETE', path, undefined, key),
}

