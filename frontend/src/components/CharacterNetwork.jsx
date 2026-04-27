import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Share2, Info, X, Maximize2, ArrowLeft } from 'lucide-react'

export default function CharacterNetwork({ characters }) {
  const svgRef = useRef()
  const [selectedChar, setSelectedChar] = useState(null)
  const [isFullScreen, setIsFullScreen] = useState(false)

  const lastCharactersLengthRef = useRef(0)

  useEffect(() => {
    if (selectedChar && characters) {
      const updated = characters.find(c => c.name === selectedChar.name)
      if (updated) setSelectedChar(updated)
    }
  }, [characters])

  useEffect(() => {
    if (!characters || characters.length === 0) return
    
    // Evitar redibujar todo si la longitud es la misma
    if (svgRef.current && characters.length === lastCharactersLengthRef.current && svgRef.current.childNodes.length > 0) {
        return
    }
    lastCharactersLengthRef.current = characters.length

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
            links.push({
              id: `${char.name}-${target}`,
              source: char.name,
              target: target,
              value: relation
            })
          }
        })
      }
    })

    // 2. Configurar SVG
    const width = 800
    const height = isFullScreen ? 700 : 500
    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove() 

    // Definir flechas (markers)
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25) 
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--slate)")
      .attr("opacity", 0.6)

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
      .force("link", d3.forceLink(links).id(d => d.id).distance(220))
      .force("charge", d3.forceManyBody().strength(-600))
      .force("center", d3.forceCenter(width / 2, height / 2))

    // Enlaces (líneas con flechas)
    const link = container.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--paper-darker, #cbd5e1)")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrowhead)")

    // Etiquetas de enlaces
    const linkText = container.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("font-size", "10px")
      .attr("fill", "var(--slate)")
      .attr("text-anchor", "middle")
      .attr("dy", -5)
      .text(d => d.value)

    // Nodos
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
      .attr("r", d => d.group === 1 ? 18 : 14)
      .attr("fill", d => d.group === 1 ? "var(--gold)" : "white")
      .attr("stroke", d => d.group === 1 ? "var(--gold-dark)" : "var(--slate)")
      .attr("stroke-width", 2.5)

    node.append("text")
      .attr("x", 22)
      .attr("y", 4)
      .attr("font-size", "14px")
      .attr("font-weight", "800")
      .attr("fill", "black")
      .text(d => d.id)

    node.append("text")
      .attr("x", 22)
      .attr("y", 18)
      .attr("font-size", "10px")
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

    return () => {
      simulation.stop()
      simulation.on("tick", null)
    }

  }, [characters, isFullScreen])

  const renderSidebar = () => (
    <AnimatePresence mode="wait">
      {selectedChar ? (
        <motion.div 
          key={selectedChar.name}
          className="sidebar-content"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
        >
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
        </motion.div>
      ) : (
        <div className="sidebar-empty">
          <Info size={32} />
          <p>Selecciona un personaje en el gráfico para ver su estudio detallado</p>
        </div>
      )}
    </AnimatePresence>
  )

  if (isFullScreen) {
    return (
      <div className="network-fullscreen-overlay">
        <div className="fs-header">
          <button className="fs-back-btn" onClick={() => setIsFullScreen(false)}>
            <ArrowLeft size={18} /> Volver a la App
          </button>
          <h2>Estudio de Personajes Interactivo</h2>
        </div>
        <div className="fs-container">
          <div className="fs-info-col">
            {renderSidebar()}
          </div>
          <div className="fs-graphic-col">
            <svg ref={svgRef} className="network-svg"></svg>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="network-layout">
      <div className="network-main">
        <div className="network-controls">
          <div className="network-hint">
            <Info size={14} /> Haz clic en un personaje
          </div>
          <button className="network-fs-btn" onClick={() => setIsFullScreen(true)}>
            <Maximize2 size={16} /> Pantalla Completa
          </button>
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
          >
            <button className="sidebar-close" onClick={() => setSelectedChar(null)}>
              <X size={18} />
            </button>
            {renderSidebar()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
