import React, { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

const PALETTE = [
  '#4f46e5', '#06b6d4', '#f59e0b', '#d4876b',
  '#10b981', '#ef4444', '#ec4899', '#8b5cf6',
]

export default function MindMap({ data }) {
  const [expanded, setExpanded] = useState(new Set())

  if (!data) return null

  const branches  = data.branches || data.nodes || data.items || data.topics || []
  const center    = data.center || data.title || data.topic || 'Libro'
  const allOpen   = expanded.size === branches.length
  const anyOpen   = expanded.size > 0

  const toggle = (i) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  const expandAll   = () => setExpanded(new Set(branches.map((_, i) => i)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="mm-wrap">

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="mm-toolbar">
        <div>
          <h2 className="mm-title">Mapa mental interactivo</h2>
          <p className="mm-hint">Pulsa en cada rama para desplegar su contenido completo</p>
        </div>
        <div className="mm-toolbar-btns">
          {anyOpen  && <button className="mm-btn-sec" onClick={collapseAll}>Colapsar todo</button>}
          {!allOpen && <button className="mm-btn-sec" onClick={expandAll}>Expandir todo</button>}
        </div>
      </div>

      {/* ── Tree ────────────────────────────────────────── */}
      <div className="mm-tree">

        {/* Root */}
        <div className="mm-root-col">
          <div className="mm-root-node">
            <span className="mm-root-text">{center}</span>
          </div>
          <div className="mm-root-line" />
        </div>

        {/* Branches */}
        <div className="mm-branches-col">
          {branches.map((branch, bi) => {
            const color    = branch.color || PALETTE[bi % PALETTE.length]
            const isOpen   = expanded.has(bi)
            const children = branch.children || branch.nodes || branch.items || []
            const label    = branch.label || branch.title || branch.text || `Rama ${bi + 1}`

            return (
              <div key={bi} className="mm-branch-block">

                {/* Branch header button */}
                <button
                  className={`mm-branch-btn ${isOpen ? 'mm-branch-open' : ''}`}
                  style={{ '--bc': color }}
                  onClick={() => toggle(bi)}
                  aria-expanded={isOpen}
                >
                  <span className="mm-branch-icon">
                    {isOpen
                      ? <ChevronDown size={14} strokeWidth={2} />
                      : <ChevronRight size={14} strokeWidth={2} />}
                  </span>
                  <span className="mm-branch-label">{label}</span>
                  {!isOpen && children.length > 0 && (
                    <span className="mm-branch-count" style={{ background: color }}>
                      {children.length}
                    </span>
                  )}
                </button>

                {/* Children */}
                {isOpen && children.length > 0 && (
                  <div className="mm-leaves">
                    {children.map((child, ci) => {
                      const text = typeof child === 'string'
                        ? child
                        : (child.label || child.text || child.title || JSON.stringify(child))
                      return (
                        <div key={ci} className="mm-leaf" style={{ borderLeftColor: color }}>
                          <span className="mm-leaf-dot" style={{ background: color }} />
                          <span className="mm-leaf-text">{text}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
