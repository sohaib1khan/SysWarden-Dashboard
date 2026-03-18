import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { alertsApi } from '../../api/alerts.js'

const TABS = [
  { to: '/overview',         label: 'Overview',   icon: '🛰️' },  { to: '/status',           label: 'Status',     icon: '📍' },  { to: '/metrics/explorer', label: 'Metrics',    icon: '📈' },
  { to: '/agents/manage',    label: 'Agents',     icon: '🤖' },
  { to: '/alerts/rules',     label: 'Alerts',     icon: '🔔' },
  { to: '/alerts/incidents', label: 'Incidents',  icon: '📋' },
  { to: '/plugins',          label: 'Plugins',    icon: '🔌' },
  { to: '/settings',         label: 'Settings',   icon: '⚙️' },
]

export default function MobileNav() {
  const [recentCount, setRecentCount] = useState(0)

  useEffect(() => {
    const check = () =>
      alertsApi.listEvents(undefined, 200)
        .then((evs) => setRecentCount(evs.filter((e) => !e.notified).length))
        .catch(() => {})
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-gray-900 border-t border-gray-800 flex overflow-x-auto z-50 scrollbar-hide"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `relative flex-shrink-0 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors w-16 ${
              isActive ? 'text-indigo-400' : 'text-gray-500'
            }`
          }
        >
          <span className="text-lg leading-none">{icon}</span>
          <span className="truncate w-full text-center">{label}</span>
          {to === '/alerts/incidents' && recentCount > 0 && (
            <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-4">
              {recentCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

