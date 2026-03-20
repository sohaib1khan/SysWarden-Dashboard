import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { alertsApi } from '../../api/alerts.js'
import { monitorsApi } from '../../api/monitors.js'
import { authApi } from '../../api/auth.js'
import { useAuthStore } from '../../store/authStore.js'

const NAV = [
  { to: '/overview',          label: '🛰️  Overview' },  { to: '/status',            label: '📍  Status' },  { to: '/metrics/explorer',  label: '📈  Metric Explorer' },
  { to: '/agents/manage',     label: '🤖  Agent Manager' },
  { to: '/alerts/rules',      label: '🔔  Alert Rules' },
  { to: '/alerts/incidents',  label: '📋  Incident Log' },
  { to: '/plugins',           label: '🔌  Plugins' },
  { to: '/settings',          label: '⚙️  Settings' },
]

export default function Sidebar() {
  const [recentCount, setRecentCount] = useState(0)
  const [downCount, setDownCount] = useState(0)
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  // Poll for unnotified events to show a badge count
  useEffect(() => {
    const check = () =>
      alertsApi.listEvents(undefined, 200)
        .then((evs) => setRecentCount(evs.filter((e) => !e.notified).length))
        .catch(() => {})
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
      }, [])

    useEffect(() => {
      const checkMonitors = () =>
        monitorsApi.list()
          .then((ms) => setDownCount(ms.filter((m) => m.status === 'down' && m.enabled).length))
          .catch(() => {})
      checkMonitors()
      const id = setInterval(checkMonitors, 30_000)
      return () => clearInterval(id)
    }, [])

  async function handleLogout() {
    try { await authApi.logout() } catch { /* ignore */ }
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="hidden md:flex w-52 bg-gray-900 border-r border-gray-800 flex-col py-6 px-4 shrink-0">
      <div className="text-xl font-bold text-indigo-400 mb-8 tracking-wide">SysWarden</div>
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `relative px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            {label}
            {to === '/status' && downCount > 0 && (
  <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-500 text-white text-xs font-bold rounded-full px-1.5">
    {downCount}
  </span>
)}
{to === '/alerts/incidents' && recentCount > 0 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-500 text-white text-xs font-bold rounded-full px-1.5">
                {recentCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {user && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="text-xs text-gray-500 truncate mb-2">{user.username}</div>
          <button
            onClick={handleLogout}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  )
}

