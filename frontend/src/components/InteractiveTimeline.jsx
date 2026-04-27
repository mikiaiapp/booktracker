import React from 'react'
import { motion } from 'framer-motion'
import { Calendar, Flag } from 'lucide-react'

export default function InteractiveTimeline({ chapters }) {
  if (!chapters || chapters.length === 0) return (
    <div className="timeline-empty">
      No hay capítulos procesados para generar la línea de tiempo.
    </div>
  )

  const timelineItems = chapters
    .filter(c => c.summary_status === 'done')
    .map((c, i) => ({
      id: c.id,
      title: c.title,
      events: c.key_events || [],
      index: i + 1
    }))

  return (
    <div className="timeline-container">
      <div className="timeline-track">
        {timelineItems.map((item, idx) => (
          <div key={item.id} className="timeline-node">
            {/* El punto en la línea */}
            <div className="node-dot-wrap">
              <div className="node-line-before" />
              <motion.div 
                className="node-dot"
                whileHover={{ scale: 1.5 }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: idx * 0.1 }}
              >
                <span className="node-number">{item.index}</span>
              </motion.div>
              <div className="node-line-after" />
            </div>

            {/* Contenido arriba/abajo alternado */}
            <div className={`node-content ${idx % 2 === 0 ? 'top' : 'bottom'}`}>
              <div className="node-card">
                <h4 className="node-title">{item.title}</h4>
                {item.events.length > 0 && (
                  <ul className="node-events">
                    {item.events.slice(0, 3).map((event, ei) => (
                      <li key={ei}>
                        <Flag size={10} style={{ marginRight: '6px', color: 'var(--gold)' }} />
                        {event}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <style dangerouslySetInnerHTML={{ __html: `
        .timeline-container {
          width: 100%;
          overflow-x: auto;
          padding: 100px 40px;
          background: var(--paper-dark);
          border-radius: 12px;
          border: 1px solid var(--border);
          scrollbar-width: thin;
        }
        .timeline-track {
          display: flex;
          min-width: max-content;
          align-items: center;
          height: 300px;
          position: relative;
        }
        .timeline-node {
          width: 250px;
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }
        .node-dot-wrap {
          display: flex;
          align-items: center;
          width: 100%;
          position: relative;
        }
        .node-dot {
          width: 32px;
          height: 32px;
          background: var(--ink);
          border: 3px solid var(--gold);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
          color: var(--gold);
          font-weight: bold;
          font-size: 0.8rem;
          cursor: pointer;
          box-shadow: 0 0 15px rgba(201, 169, 110, 0.3);
        }
        .node-line-before, .node-line-after {
          flex: 1;
          height: 2px;
          background: var(--border);
        }
        .timeline-node:first-child .node-line-before { visibility: hidden; }
        .timeline-node:last-child .node-line-after { visibility: hidden; }
        
        .node-content {
          position: absolute;
          width: 220px;
          text-align: center;
        }
        .node-content.top { bottom: 50px; }
        .node-content.bottom { top: 50px; }
        
        .node-card {
          background: var(--paper);
          padding: 1rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
          transition: transform 0.2s;
        }
        .node-card:hover {
          transform: translateY(-5px);
          border-color: var(--gold);
        }
        .node-title {
          margin: 0 0 0.5rem 0;
          font-size: 0.9rem;
          color: var(--ink);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .node-events {
          margin: 0;
          padding: 0;
          list-style: none;
          text-align: left;
        }
        .node-events li {
          font-size: 0.75rem;
          color: var(--slate);
          margin-bottom: 4px;
          line-height: 1.2;
          display: flex;
          align-items: flex-start;
        }
        .timeline-empty {
          padding: 3rem;
          text-align: center;
          color: var(--slate);
          background: var(--paper-dark);
          border-radius: 12px;
        }
      `}} />
    </div>
  )
}
