import { create } from 'zustand'

// Token storage:
//   remember=true  → localStorage   (persists after browser close)
//   remember=false → sessionStorage  (cleared when browser closes)
const TOKEN_KEY = 'sw_token'
const USER_KEY  = 'sw_user'

// On init, prefer localStorage (remember=true), fall back to sessionStorage.
function _readToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null
}
function _readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export const useAuthStore = create((set) => ({
  token: _readToken(),
  user:  _readUser(),

  setAuth: (token, user, remember = true) => {
    const store  = remember ? localStorage : sessionStorage
    const other  = remember ? sessionStorage : localStorage
    store.setItem(TOKEN_KEY, token)
    store.setItem(USER_KEY, JSON.stringify(user))
    // Clear from the other storage so no stale copy lingers
    other.removeItem(TOKEN_KEY)
    other.removeItem(USER_KEY)
    set({ token, user })
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    set({ token: null, user: null })
  },
}))
