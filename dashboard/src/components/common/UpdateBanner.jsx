import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * UpdateBanner — shows a sticky bar at the top when a new service worker
 * version is waiting, giving the user a one-click "Reload & update" button.
 */
export default function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [dismissed, setDismissed] = useState(false)

  // Reset dismissed state when a new update arrives
  useEffect(() => {
    if (needRefresh) setDismissed(false)
  }, [needRefresh])

  if (!needRefresh || dismissed) return null

  return (
    <div className="fixed top-0 inset-x-0 z-[60] bg-indigo-700 text-white text-sm
                    flex items-center justify-between gap-4 px-4 py-2 shadow-lg">
      <span>A new version of SysWarden is available.</span>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => updateServiceWorker(true)}
          className="bg-white text-indigo-700 font-semibold rounded px-3 py-1 hover:bg-indigo-50 transition-colors"
        >
          Reload &amp; update
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-indigo-200 hover:text-white transition-colors px-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
