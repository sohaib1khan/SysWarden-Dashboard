export default function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className}`}>
      {title && (
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}
