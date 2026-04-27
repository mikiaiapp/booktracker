import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Share2, Info, X } from 'lucide-react'

export default function CharacterNetwork({ characters }) {
  const svgRef = useRef()
  const [selectedChar, setSelectedChar] = useState(null)

  useEffect(() => {
    if (!characters || characters.length === 0) return

    // 1. Preparar datos
    const nodes = characters.map(c => ({ 
      id: c.name, 
      group: c.is_main ? 1 : 2,
      role: c.role || '',
      fullData: c
    }))

    const links = []
    characters.forEach(char => {
      if (char.relationships) {
        Object.entries(char.relationships).forEach(([target, relation]) => {
          if (characters.find(c => c.name === target)) {
            const pair = [char.name, target].sort()
            const linkId = pair.join('-')
            if (!links.find(l => l.id === linkId)) {
              links.push({
                id: linkId,
                source: char.name,
                target: target,
                value: relation
              })
            }
          }
        })
      }
    })

    // 2. Configurar SVG
    const width = 800
    const height = 500
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove() 

    const container = svg
      .attr("viewBox", [0, 0, width, height])
      .append("g")

    // Zoom
    const zoom = d3.zoom().on("zoom", (event) => {
      container.attr("transform", event.transform)
    })
    svg.call(zoom)

    // Simulación de fuerzas
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(180))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))

    // Enlaces (líneas)
    const link = container.append("g")
      .attr("stroke", "var(--paper-darker, #e2e8f0)")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5)

    // Etiquetas de enlaces
    const linkText = container.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("font-size", "9px")
      .attr("fill", "var(--slate)")
      .attr("text-anchor", "middle")
      .attr("dy", -5)
      .text(d => d.value)

    // Nodos (círculos)
    const node = container.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        setSelectedChar(d.fullData)
        event.stopPropagation()
      })
      .call(drag(simulation))

    node.append("circle")
      .attr("r", d => d.group === 1 ? 14 : 10)
      .attr("fill", d => d.group === 1 ? "var(--gold)" : "white")
      .attr("stroke", d => d.group === 1 ? "var(--gold-dark)" : "var(--paper-darker, #e2e8f0)")
      .attr("stroke-width", 2)
      .attr("class", "node-circle")

    // Nombres de personajes
    node.append("text")
      .attr("x", 18)
      .attr("y", 4)
      .attr("font-size", "12px")
      .attr("font-weight", d => d.group === 1 ? "bold" : "600")
      .attr("fill", "var(--ink)")
      .text(d => d.id)

    // Roles
    node.append("text")
      .attr("x", 18)
      .attr("y", 16)
      .attr("font-size", "9px")
      .attr("fill", "var(--slate)")
      .text(d => d.role.length > 30 ? d.role.substring(0, 30) + '...' : d.role)

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y)

      linkText
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2)

      node
        .attr("transform", d => `translate(${d.x},${d.y})`)
    })

    function drag(simulation) {
      function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        event.subject.fx = event.subject.x
        event.subject.fy = event.subject.y
      }
      function dragged(event) {
        event.subject.fx = event.x
        event.subject.fy = event.y
      }
      function dragended(event) {
        if (!event.active) simulation.alphaTarget(0)
        event.subject.fx = null
        event.subject.fy = null
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended)
    }

    svg.on("click", () => setSelectedChar(null))

  }, [characters])

  return (
    <div className="network-layout">
      <div className="network-main">
        <div className="network-hint">
          <Info size={14} /> Haz clic en un personaje para ver sus detalles
        </div>
        <svg ref={svgRef} className="network-svg"></svg>
      </div>
      
      <AnimatePresence>
        {selectedChar && (
          <motion.div 
            className="network-sidebar"
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            <button className="sidebar-close" onClick={() => setSelectedChar(null)}>
              <X size={18} />
            </button>
            
            <div className="sidebar-content">
              <div className="sidebar-header">
                <div className="sidebar-avatar">{selectedChar.name.charAt(0)}</div>
                <div className="sidebar-title">
                  <h3>{selectedChar.name}</h3>
                  <span className="sidebar-role-badge">{selectedChar.role || 'Personaje'}</span>
                </div>
              </div>

              <div className="sidebar-section">
                <h4><User size={14} /> Descripción</h4>
                <p>{selectedChar.description || 'Sin descripción disponible.'}</p>
              </div>

              {selectedChar.relationships && Object.keys(selectedChar.relationships).length > 0 && (
                <div className="sidebar-section">
                  <h4><Share2 size={14} /> Relaciones</h4>
                  <div className="sidebar-rel-list">
                    {Object.entries(selectedChar.relationships).map(([name, rel], i) => (
                      <div key={i} className="sidebar-rel-item">
                        <span className="rel-name">{name}</span>
                        <span className="rel-type">{rel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
