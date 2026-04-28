import React from 'react'
import { motion } from 'framer-motion'
import { Flag, ChevronDown, BookOpen } from 'lucide-react'

export default function InteractiveTimeline({ chapters }) {
  if (!chapters || chapters.length === 0) return (
    <div className="timeline-empty">
      <BookOpen size={48} style={{ opacity: 0.1, marginBottom: '1rem' }} />
      <p>No hay capítulos procesados para generar la línea de tiempo.</p>
    </div>
  )

  const timelineItems = chapters
    .filter(c => c.summary_status === 'done')
    .map((c, i) => ({
      id: c.id,
      title: c.title,
      events: c.key_events || [],
      index: i + 1,
      summary: c.summary
    }))

  return (
    <div className="timeline-vertical-container">
      <div className="timeline-vertical-track">
        {timelineItems.map((item, idx) => (
          <motion.div 
            key={item.id} 
            className="timeline-vertical-item"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.1 }}
          >
            <div className="timeline-left">
              <div className="item-number-circle">{item.index}</div>
              {idx < timelineItems.length - 1 && <div className="item-connector-line" />}
            </div>
            
            <div className="timeline-right">
              <div className="timeline-card-premium">
                <div className="card-accent-bar" />
                <h4 className="item-title">{item.title}</h4>
                
                {item.summary && (
                  <p className="item-summary-snippet">
                    {item.summary.length > 200 ? item.summary.substring(0, 200) + '...' : item.summary}
                  </p>
                )}

                {item.events.length > 0 && (
                  <div className="item-events-list">
                    {item.events.map((event, ei) => (
                      <div key={ei} className="event-pill">
                        <Flag size={10} className="event-icon" />
                        <span>{event}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .timeline-vertical-container {
          width: 100%;
          max-width: 900px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }
        
        .timeline-vertical-track {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        
        .timeline-vertical-item {
          display: flex;
          gap: 2rem;
          min-height: 120px;
        }
        
        .timeline-left {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 40px;
          flex-shrink: 0;
        }
        
        .item-number-circle {
          width: 36px;
          height: 36px;
          background: var(--ink);
          border: 3px solid var(--gold);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gold);
          font-weight: 800;
          font-size: 0.9rem;
          z-index: 2;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        }
        
        .item-connector-line {
          width: 3px;
          flex: 1;
          background: linear-gradient(to bottom, var(--gold), transparent);
          opacity: 0.3;
          margin: 4px 0;
        }
        
        .timeline-right {
          flex: 1;
          padding-bottom: 3rem;
        }
        
        .timeline-card-premium {
          background: white;
          padding: 1.5rem;
          border-radius: 16px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .timeline-card-premium:hover {
          transform: translateX(10px);
          border-color: var(--gold);
          box-shadow: var(--shadow-md);
        }
        
        .card-accent-bar {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--gold);
          opacity: 0.5;
        }
        
        .item-title {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
          color: var(--ink);
          font-family: var(--font-display);
          font-weight: 700;
        }
        
        .item-summary-snippet {
          font-size: 0.9rem;
          color: var(--slate);
          line-height: 1.5;
          margin-bottom: 1.25rem;
          font-style: italic;
        }
        
        .item-events-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        
        .event-pill {
          background: var(--paper-dark);
          color: var(--ink);
          padding: 0.3rem 0.7rem;
          border-radius: 20px;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          border: 1px solid rgba(0,0,0,0.05);
        }
        
        .event-icon {
          color: var(--gold);
        }
        
        .timeline-empty {
          padding: 5rem;
          text-align: center;
          color: var(--slate);
          background: var(--paper-dark);
          border-radius: 24px;
          border: 2px dashed rgba(0,0,0,0.05);
        }
      `}} />
    </div>
  )
}
