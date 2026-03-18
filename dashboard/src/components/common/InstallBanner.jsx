import { usePWAInstall } from '../../hooks/usePWAInstall.js'

/**
 * Thin install banner shown at the bottom of the screen when the browser
 * indicates the PWA is installable. Dismissed once the user installs or
 * taps "Not now".
 */
export default function InstallBanner() {
  const { canInstall, promptInstall } = usePWAInstall()

  if (!canInstall) return null

  return (
    <div className="fixed bottom-16 inset-x-0 z-40 flex justify-center px-4 md:bottom-4 pointer-events-none">
      <div className="bg-indigo-700 text-white text-sm rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-sm w-full pointer-events-auto">
        <span className="text-xl">📲</span>
        <span className="flex-1">Install SysWarden for quick access</span>
        <button
          onClick={promptInstall}
          className="bg-white text-indigo-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors shrink-0"
        >
          Install
        </button>
      </div>
    </div>
  )
}
