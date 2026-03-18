import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth.js'
import { useAuthStore } from '../store/authStore.js'

export default function Login() {
  const navigate   = useNavigate()
  const setAuth    = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error,    setError   ] = useState('')
  const [loading,  setLoading ] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(username, password)
      setAuth(data.access_token, data.user, remember)
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-indigo-400 tracking-wide">SysWarden</div>
          <div className="text-gray-500 text-sm mt-1">Sign in to your account</div>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <div className="w-9 h-5 bg-gray-700 peer-checked:bg-indigo-600 rounded-full transition-colors" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
            </div>
            <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
              Keep me logged in
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-md py-2 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>


      </div>
    </div>
  )
}
