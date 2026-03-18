/**
 * 🧭 SiteNavigator
 *
 * A floating help widget that slides in from the bottom-right.
 * Draggable: grab the panel header or FAB area to reposition anywhere on screen.
 * Double-click the FAB to snap back to the default corner.
 * Position persists across reloads (localStorage: sw_nav_pos).
 *
 * Content lives in ../navigator/config.js — edit that file to update docs.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { NAVIGATOR_PAGES, findGuide } from './config.js'

// ── Small sub-components ───────────────────────────────────────────────────────

function SectionBlock({ section, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-200 hover:bg-white/[0.04] transition-colors"
      >
        <span>{section.heading}</span>
        <span className="text-gray-600 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-white/[0.05] bg-black/20">
          <p className="text-[12.5px] text-gray-400 leading-relaxed mt-2.5 whitespace-pre-line">
            {section.body}
          </p>
          {section.tip && (
            <div className="mt-2 flex items-start gap-2 bg-indigo-500/[0.08] border border-indigo-500/20 rounded-lg px-3 py-2">
              <span className="text-indigo-400 text-sm shrink-0 mt-px">💡</span>
              <p className="text-[11.5px] text-indigo-300/80 leading-relaxed">{section.tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PageList({ onSelect, currentPath }) {
  return (
    <div className="space-y-1">
      {NAVIGATOR_PAGES.map(page => {
        const isActive =
          page.route instanceof RegExp
            ? page.route.test(currentPath)
            : currentPath.startsWith(page.route)
        return (
          <button
            key={typeof page.route === 'string' ? page.route : page.title}
            type="button"
            onClick={() => onSelect(page)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all text-sm ${
              isActive
                ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-300'
                : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200 border border-transparent'
            }`}
          >
            <span className="text-base shrink-0">{page.icon}</span>
            <div className="min-w-0">
              <div className="font-medium leading-tight truncate">{page.title}</div>
              <div className="text-[10.5px] text-gray-600 leading-tight mt-0.5 truncate">{page.summary.slice(0, 55)}…</div>
            </div>
            {isActive && <span className="ml-auto text-[9px] bg-indigo-500/30 text-indigo-400 px-1.5 py-0.5 rounded-full shrink-0">current</span>}
          </button>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SiteNavigator() {
  const location = useLocation()
  const [open, setOpen]           = useState(false)
  const [view, setView]           = useState('guide') // 'guide' | 'pages' | 'search'
  const [guide, setGuide]         = useState(null)
  const [search, setSearch]       = useState('')
  const [minimised, setMinimised] = useState(() => {
    try { return localStorage.getItem('sw_nav_minimised') === '1' } catch { return false }
  })

  // ── Drag position ─────────────────────────────────────────────────────────
  // null  →  use default CSS corner (bottom-right)
  // {x,y} →  use inline style (top/left in px, clamped to viewport)
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('sw_nav_pos')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const posRef      = useRef(pos)    // always-fresh pos for use inside event closures
  const containerRef = useRef(null)  // outer wrapper (also handles outside-click)
  const dragState   = useRef(null)   // active drag tracking
  const isDragged   = useRef(false)  // suppresses click after a drag completes

  useEffect(() => { posRef.current = pos }, [pos])

  // Update guide when route changes
  useEffect(() => {
    const g = findGuide(location.pathname)
    setGuide(g)
    setView('guide')
    setSearch('')
  }, [location.pathname])

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Drag implementation ───────────────────────────────────────────────────
  // Attach to: panel header (when open) OR the FAB row / minimised pill.
  // Dragging from inside the panel body is intentionally excluded so the user
  // can still click sections, scroll, etc.
  const handleDragMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    const rect = containerRef.current.getBoundingClientRect()
    dragState.current = {
      startX:   e.clientX,
      startY:   e.clientY,
      origLeft: rect.left,
      origTop:  rect.top,
      moved:    false,
    }

    function onMove(e) {
      if (!dragState.current) return
      const dx = e.clientX - dragState.current.startX
      const dy = e.clientY - dragState.current.startY
      if (!dragState.current.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragState.current.moved = true
      }
      if (dragState.current.moved) {
        e.preventDefault()
        const cRect = containerRef.current?.getBoundingClientRect()
        const w = cRect ? cRect.width  : 56
        const h = cRect ? cRect.height : 56
        const newLeft = Math.max(4, Math.min(window.innerWidth  - w - 4, dragState.current.origLeft + dx))
        const newTop  = Math.max(4, Math.min(window.innerHeight - h - 4, dragState.current.origTop  + dy))
        setPos({ x: newLeft, y: newTop })
      }
    }

    function onUp() {
      const wasMoved = dragState.current?.moved ?? false
      dragState.current = null
      if (wasMoved) {
        isDragged.current = true
        setTimeout(() => { isDragged.current = false }, 20)
        try { localStorage.setItem('sw_nav_pos', JSON.stringify(posRef.current)) } catch {}
      }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  function resetPos() {
    setPos(null)
    try { localStorage.removeItem('sw_nav_pos') } catch {}
  }

  function toggleMinimise() {
    setMinimised(v => {
      const next = !v
      try { localStorage.setItem('sw_nav_minimised', next ? '1' : '0') } catch {}
      return next
    })
  }

  // ── Filtering helpers ─────────────────────────────────────────────────────
  const filteredSections = guide?.sections?.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.heading.toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q) ||
      (s.tip || '').toLowerCase().includes(q)
    )
  }) ?? []

  const allPages = search
    ? NAVIGATOR_PAGES.filter(p =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.summary.toLowerCase().includes(search.toLowerCase()) ||
        p.sections.some(s =>
          s.heading.toLowerCase().includes(search.toLowerCase()) ||
          s.body.toLowerCase().includes(search.toLowerCase())
        )
      )
    : null

  // ── Outer container positioning ───────────────────────────────────────────
  // When pos is set: fixed at exactly {x,y}.  When null: Tailwind's bottom-right defaults.
  const containerStyle = pos ? { position: 'fixed', left: pos.x, top: pos.y } : undefined
  const containerClass = pos
    ? 'fixed z-50 flex flex-col items-end gap-2'
    : 'fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex flex-col items-end gap-2'

  return (
    <div
      ref={containerRef}
      className={containerClass}
      style={containerStyle}
    >
      {/* ── Slide-up panel ─────────────────────────────────────────── */}
      {open && (
        <div
          className="w-[340px] sm:w-[380px] bg-gray-950 border border-white/[0.09] rounded-2xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
          style={{ maxHeight: 'min(540px, calc(100dvh - 120px))' }}
        >
          {/* Header — drag handle when panel is open */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06] bg-black/30 shrink-0 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleDragMouseDown}
            title="Drag to move"
          >
            <span className="text-gray-700 text-sm mr-0.5 leading-none select-none" title="Drag to move">⠿</span>
            <span className="text-xl">🧭</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white leading-tight">Site Navigator</div>
              <div className="text-[10.5px] text-gray-500 leading-tight mt-px">
                {guide ? guide.title : 'Browse all guides'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {pos && (
                <button
                  type="button"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={resetPos}
                  title="Reset to default position"
                  className="text-[10px] px-1.5 py-0.5 rounded border border-white/[0.07] text-gray-600 hover:text-gray-300 hover:bg-white/[0.05] transition-colors"
                >
                  ⤢
                </button>
              )}
              <button
                type="button"
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setView(v => v === 'pages' ? 'guide' : 'pages')}
                title="Browse all pages"
                className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                  view === 'pages'
                    ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                    : 'border-white/[0.07] text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]'
                }`}
              >
                All pages
              </button>
              <button
                type="button"
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/[0.06] transition-colors text-sm"
              >×</button>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-white/[0.05] shrink-0">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
              <input
                type="search"
                value={search}
                onChange={e => { setSearch(e.target.value); setView(e.target.value ? 'search' : 'guide') }}
                placeholder="Search help…"
                className="w-full bg-gray-900/80 border border-gray-800 focus:border-indigo-500/50 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-3 space-y-2">
            {/* Search results across all pages */}
            {view === 'search' && allPages && (
              allPages.length === 0 ? (
                <p className="text-center text-gray-600 text-xs py-8">No results for "{search}"</p>
              ) : (
                allPages.map(page => (
                  <div key={page.title}>
                    <div className="flex items-center gap-1.5 mb-1.5 px-1">
                      <span className="text-sm">{page.icon}</span>
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{page.title}</span>
                    </div>
                    <div className="space-y-1">
                      {page.sections.filter(s =>
                        !search ||
                        s.heading.toLowerCase().includes(search.toLowerCase()) ||
                        s.body.toLowerCase().includes(search.toLowerCase()) ||
                        (s.tip || '').toLowerCase().includes(search.toLowerCase())
                      ).map((s, i) => (
                        <SectionBlock key={i} section={s} defaultOpen />
                      ))}
                    </div>
                  </div>
                ))
              )
            )}

            {/* All pages list */}
            {view === 'pages' && !search && (
              <PageList
                onSelect={p => { setGuide(p); setView('guide') }}
                currentPath={location.pathname}
              />
            )}

            {/* Current page guide */}
            {view === 'guide' && !search && (
              guide ? (
                <>
                  <div className="bg-gradient-to-r from-indigo-900/20 to-purple-900/10 border border-indigo-500/15 rounded-xl px-4 py-3 mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{guide.icon}</span>
                      <span className="text-sm font-semibold text-white">{guide.title}</span>
                    </div>
                    <p className="text-[11.5px] text-gray-400 leading-relaxed">{guide.summary}</p>
                  </div>
                  <div className="space-y-1.5">
                    {guide.sections.map((s, i) => (
                      <SectionBlock key={i} section={s} defaultOpen={i === 0} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-600 text-xs mb-3">No guide for this page yet.</p>
                  <button
                    type="button"
                    onClick={() => setView('pages')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >Browse all pages →</button>
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.05] bg-black/20 shrink-0 flex items-center justify-between">
            <span className="text-[10px] text-gray-700">
              {guide ? `${guide.sections.length} topics` : `${NAVIGATOR_PAGES.length} pages`}
            </span>
            <span className="text-[10px] text-gray-700">SysWarden Help</span>
          </div>
        </div>
      )}

      {/* ── FAB button row ────────────────────────────────────────── */}
      {!minimised ? (
        <div
          className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragMouseDown}
          title="Drag to move · double-click compass to reset position"
        >
          {/* Mini label chip */}
          {!open && (
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => { if (isDragged.current) return; setOpen(true) }}
              className="flex items-center gap-2 bg-gray-900/95 border border-white/[0.10] rounded-full pl-3 pr-2 py-1.5 shadow-xl hover:border-indigo-500/50 transition-all group"
            >
              <span className="text-[13px]">🧭</span>
              <span className="text-[11px] font-medium text-gray-300 group-hover:text-white transition-colors">Site Navigator</span>
              <span className="text-[9px] text-gray-600 group-hover:text-gray-400 ml-0.5">Ask me where to go</span>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse ml-1" />
            </button>
          )}

          {/* Main compass FAB — double-click resets position */}
          <button
            type="button"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => { if (isDragged.current) return; setOpen(v => !v) }}
            onDoubleClick={resetPos}
            title={pos ? 'Toggle · double-click to reset position' : 'Toggle Site Navigator'}
            className={`w-11 h-11 rounded-full border shadow-xl flex items-center justify-center text-xl transition-all active:scale-95 ${
              open
                ? 'bg-indigo-600 border-indigo-500 shadow-indigo-500/40 rotate-0'
                : 'bg-gray-900/95 border-white/[0.12] hover:bg-gray-800 hover:border-indigo-500/50 hover:shadow-indigo-500/20'
            }`}
          >
            {open ? '×' : '🧭'}
          </button>

          {/* Minimise */}
          <button
            type="button"
            onMouseDown={e => e.stopPropagation()}
            onClick={toggleMinimise}
            title="Minimise"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-900/80 border border-white/[0.07] text-gray-600 hover:text-gray-400 text-xs transition-colors shadow"
          >_</button>
        </div>
      ) : (
        /* Minimised pill — also draggable */
        <button
          type="button"
          onMouseDown={handleDragMouseDown}
          onClick={() => { if (isDragged.current) return; toggleMinimise() }}
          title="Show Site Navigator"
          className="flex items-center gap-1.5 bg-gray-900/90 border border-white/[0.08] rounded-full px-2.5 py-1 text-[10px] text-gray-500 hover:text-gray-300 hover:border-indigo-500/40 transition-all shadow cursor-grab active:cursor-grabbing"
        >
          <span>🧭</span>
          <span>Help</span>
        </button>
      )}
    </div>
  )
}
