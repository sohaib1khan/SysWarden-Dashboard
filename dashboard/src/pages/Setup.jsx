import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth.js'
import { useAuthStore } from '../store/authStore.js'

export default function Setup() {
  const navigate  = useNavigate()
  const setAuth   = useAuthStore((s) => s.setAuth)
  const [username, setUsername]   = useState('')
  const [password, setPassword]   = useState('')
  const [confirm,  setConfirm ]   = useState('')
  const [error,    setError   ]   = useState('')
  const [loading,  setLoading ]   = useState(false)
  const [checking, setChecking]   = useState(true)

  // If users already exist, setup is closed — redirect to login
  useEffect(() => {
    authApi.setup()
      .then(({ required }) => {
        if (!required) navigate('/login', { replace: true })
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const data = await authApi.register(username, password)
      setAuth(data.access_token, data.user)
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500 text-sm">
        Checking setup status…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-indigo-400 tracking-wide">SysWarden</div>
          <div className="text-gray-500 text-sm mt-1">Create your admin account</div>
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-md py-2 transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
