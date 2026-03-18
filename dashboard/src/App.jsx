import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import Sidebar from './components/layout/Sidebar.jsx'
import MobileNav from './components/layout/MobileNav.jsx'
import UpdateBanner from './components/common/UpdateBanner.jsx'
import InstallBanner from './components/common/InstallBanner.jsx'
import SiteNavigator from './navigator/SiteNavigator.jsx'
import { useAuthStore } from './store/authStore.js'
import { authApi } from './api/auth.js'

// Lazy-load pages to split Recharts / heavy chunks away from the initial bundle
const Overview       = lazy(() => import('./pages/Overview.jsx'))
const AgentDetail    = lazy(() => import('./pages/AgentDetail.jsx'))
const AlertRules     = lazy(() => import('./pages/AlertRules.jsx'))
const IncidentLog    = lazy(() => import('./pages/IncidentLog.jsx'))
const MetricExplorer = lazy(() => import('./pages/MetricExplorer.jsx'))
const AgentManager   = lazy(() => import('./pages/AgentManager.jsx'))
const Settings       = lazy(() => import('./pages/Settings.jsx'))
const Plugins        = lazy(() => import('./pages/Plugins.jsx'))
const Status         = lazy(() => import('./pages/Status.jsx'))
const Login          = lazy(() => import('./pages/Login.jsx'))
const Setup          = lazy(() => import('./pages/Setup.jsx'))

function PageLoader() {
  return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
}

// Validates the stored token on mount; redirects to /login or /setup if needed
function AuthGate({ children }) {
  const { token, setAuth, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Public routes — no auth check needed
    if (location.pathname === '/login' || location.pathname === '/setup') {
      setReady(true)
      return
    }

    if (!token) {
      // Check whether first-time setup is needed
      authApi.setup()
        .then(({ required }) => navigate(required ? '/setup' : '/login', { replace: true }))
        .catch(() => navigate('/login', { replace: true }))
        .finally(() => setReady(true))
      return
    }

    // Verify token is still valid
    authApi.me()
      .then((user) => {
        setAuth(token, user)
        setReady(true)
      })
      .catch(() => {
        // Try silent refresh via HttpOnly cookie
        authApi.refresh()
          .then((data) => {
            setAuth(data.access_token, data.user)
            setReady(true)
          })
          .catch(() => {
            logout()
            navigate('/login', { replace: true })
            setReady(true)
          })
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <PageLoader />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </Suspense>
    </BrowserRouter>
  )
}

function AppShell() {
  const location = useLocation()
  const isPublic = location.pathname === '/login' || location.pathname === '/setup'

  if (isPublic) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <UpdateBanner />
      <InstallBanner />
      <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/agents/:agentId" element={<AgentDetail />} />
              <Route path="/metrics/explorer" element={<MetricExplorer />} />
              <Route path="/agents/manage" element={<AgentManager />} />
              <Route path="/alerts/rules" element={<AlertRules />} />
              <Route path="/alerts/incidents" element={<IncidentLog />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/plugins" element={<Plugins />} />
              <Route path="/status" element={<Status />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <MobileNav />
      <SiteNavigator />
    </>
  )
}

