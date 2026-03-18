export default function StatusBadge({ online }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        online
          ? 'bg-green-900 text-green-300'
          : 'bg-red-900 text-red-300'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  )
}
