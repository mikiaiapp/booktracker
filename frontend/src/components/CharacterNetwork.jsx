import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'

export default function CharacterNetwork({ characters }) {
  const svgRef = useRef()

  useEffect(() => {
    if (!characters || characters.length === 0) return

    // 1. Preparar datos
    const nodes = characters.map(c => ({ 
      id: c.name, 
      group: c.is_main ? 1 : 2,
      role: c.role || ''
    }))

    const links = []
    characters.forEach(char => {
      if (char.relationships) {
        Object.entries(char.relationships).forEach(([target, relation]) => {
          // Solo añadir si el target existe en nuestra lista de personajes
          if (characters.find(c => c.name === target)) {
            // Evitar duplicados si la relación es bidireccional (simple deduplicación por orden alfabético)
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
    svg.selectAll("*").remove() // Limpiar

    const container = svg
      .attr("viewBox", [0, 0, width, height])
      .append("g")

    // Zoom
    svg.call(d3.zoom().on("zoom", (event) => {
      container.attr("transform", event.transform)
    }))

    // Simulación de fuerzas
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))

    // Enlaces (líneas)
    const link = container.append("g")
      .attr("stroke", "var(--slate)")
      .attr("stroke-opacity", 0.4)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 2)

    // Etiquetas de enlaces
    const linkText = container.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("font-size", "10px")
      .attr("fill", "var(--slate)")
      .attr("text-anchor", "middle")
      .text(d => d.value)

    // Nodos (círculos)
    const node = container.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(drag(simulation))

    node.append("circle")
      .attr("r", d => d.group === 1 ? 12 : 8)
      .attr("fill", d => d.group === 1 ? "var(--gold)" : "var(--slate)")
      .attr("stroke", "var(--paper)")
      .attr("stroke-width", 2)

    // Nombres de personajes
    node.append("text")
      .attr("x", 15)
      .attr("y", 5)
      .attr("font-size", "12px")
      .attr("font-weight", d => d.group === 1 ? "bold" : "normal")
      .attr("fill", "var(--ink)")
      .text(d => d.id)

    // Roles (opcional, más pequeño)
    node.append("text")
      .attr("x", 15)
      .attr("y", 18)
      .attr("font-size", "9px")
      .attr("fill", "var(--slate)")
      .text(d => d.role)

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

  }, [characters])

  return (
    <div className="network-container" style={{ background: 'var(--paper-dark)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '500px', cursor: 'move' }}></svg>
    </div>
  )
}
