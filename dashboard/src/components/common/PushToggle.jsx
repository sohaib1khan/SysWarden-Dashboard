import { usePush } from '../../hooks/usePush.js'

export default function PushToggle() {
  const { supported, isSecure, loading, permission, subscribed, subscribe, unsubscribe, error } = usePush()

  if (!supported) return null

  // Push API requires a secure context (HTTPS or localhost)
  if (!isSecure) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Push alerts:</span>
        <span
          className="text-yellow-400/70 text-xs"
          title="Web Push requires HTTPS. Set up a reverse proxy with TLS to enable push notifications."
        >
          🔒 HTTPS required
        </span>
      </div>
    )
  }

  if (loading) return null

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-gray-400">Push alerts:</span>
      {permission === 'denied' ? (
        <span className="text-yellow-500 text-xs">
          Blocked by browser — enable Notifications in site settings
        </span>
      ) : subscribed ? (
        <button
          onClick={unsubscribe}
          className="text-xs px-2 py-0.5 rounded bg-green-800 text-green-300 hover:bg-green-700 transition-colors"
        >
          ✓ Subscribed — tap to disable
        </button>
      ) : (
        <button
          onClick={subscribe}
          className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
        >
          Enable push notifications
        </button>
      )}
      {error && <span className="text-red-400 text-xs ml-2">{error}</span>}
    </div>
  )
}
