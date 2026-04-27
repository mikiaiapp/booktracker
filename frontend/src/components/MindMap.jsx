import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronDown, Maximize2, Minimize2 } from 'lucide-react'

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
    <div className="mm-premium-container">
      <div className="mm-header">
        <div className="mm-header-text">
          <h2 className="mm-title">Mapa mental interactivo</h2>
          <p className="mm-hint">Explora la estructura del libro desplegando cada nodo</p>
        </div>
        <div className="mm-controls">
          <button className="mm-control-btn" onClick={anyOpen ? collapseAll : expandAll}>
            {anyOpen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            <span>{anyOpen ? 'Colapsar todo' : 'Expandir todo'}</span>
          </button>
        </div>
      </div>

      <div className="mm-content">
        <div className="mm-root-section">
           <motion.div 
             className="mm-central-node"
             whileHover={{ scale: 1.02 }}
           >
             <span className="mm-central-label">{center}</span>
           </motion.div>
           <div className="mm-vertical-line" />
        </div>

        <div className="mm-branches-grid">
          {branches.map((branch, bi) => {
            const color = PALETTE[bi % PALETTE.length]
            const isOpen = expanded.has(bi)
            const children = branch.children || branch.nodes || branch.items || []
            const label = branch.label || branch.title || branch.text || `Rama ${bi + 1}`

            return (
              <div key={bi} className="mm-branch-wrapper">
                <motion.button
                  className={`mm-branch-node ${isOpen ? 'is-open' : ''}`}
                  style={{ '--branch-color': color }}
                  onClick={() => toggle(bi)}
                  layout
                >
                  <div className="mm-branch-indicator" style={{ background: color }} />
                  <span className="mm-branch-text">{label}</span>
                  <div className="mm-branch-actions">
                    {children.length > 0 && (
                      <span className="mm-branch-badge" style={{ background: isOpen ? 'white' : color, color: isOpen ? color : 'white' }}>
                        {children.length}
                      </span>
                    )}
                    <div className={`mm-chevron ${isOpen ? 'rotated' : ''}`}>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </motion.button>

                <AnimatePresence>
                  {isOpen && children.length > 0 && (
                    <motion.div 
                      className="mm-children-container"
                      initial={{ height: 0, opacity: 0, x: -10 }}
                      animate={{ height: 'auto', opacity: 1, x: 0 }}
                      exit={{ height: 0, opacity: 0, x: -10 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      {children.map((child, ci) => {
                        const text = typeof child === 'string'
                          ? child
                          : (child.label || child.text || child.title || JSON.stringify(child))
                        return (
                          <motion.div 
                            key={ci} 
                            className="mm-child-node"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: ci * 0.05 }}
                          >
                            <div className="mm-child-dot" style={{ background: color }} />
                            <span className="mm-child-text">{text}</span>
                          </motion.div>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
