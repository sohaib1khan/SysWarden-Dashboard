/**
 * Shared utility components used by capability panels.
 */

/** Spinner shown while a fetch is in-flight */
export function Spinner() {
  return (
    <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Running…
    </div>
  )
}

/** Red error box */
export function ErrorBox({ message }) {
  return (
    <div className="rounded bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 mt-2 whitespace-pre-wrap">
      {message}
    </div>
  )
}

/** Run button */
export function RunButton({ onClick, loading, label = 'Run' }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
    >
      {loading ? 'Running…' : label}
    </button>
  )
}
