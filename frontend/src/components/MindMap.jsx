import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Maximize2, Minimize2 } from 'lucide-react'

export default function MindMap({ data }) {
  const ref = useRef()
  const [collapsedNodes, setCollapsedNodes] = useState(new Set())
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleNode = (nodeId) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  useEffect(() => {
    if (!data || !ref.current) return
    const el = ref.current
    el.innerHTML = ''

    const width = el.clientWidth || 800
    const height = isFullscreen ? window.innerHeight - 100 : 600
    const margin = { top: 20, right: 120, bottom: 20, left: 120 }

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', 'var(--font-body)')
      .style('cursor', 'grab')
      .on('mousedown', function() {
        d3.select(this).style('cursor', 'grabbing')
      })
      .on('mouseup', function() {
        d3.select(this).style('cursor', 'grab')
      })

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Build hierarchy with IDs for tracking collapsed state
    const root = {
      name: data.center,
      id: 'root',
      children: (data.branches || []).map((b, i) => ({
        name: b.label,
        id: `branch-${i}`,
        color: b.color || '#6366f1',
        children: (b.children || []).map((c, j) => ({ 
          name: c, 
          id: `leaf-${i}-${j}`,
          leaf: true 
        }))
      }))
    }

    // Filter collapsed nodes
    const filterCollapsed = (node) => {
      if (collapsedNodes.has(node.id) && node.children) {
        return { ...node, children: null, _children: node.children }
      }
      if (node.children) {
        return {
          ...node,
          children: node.children.map(filterCollapsed)
        }
      }
      return node
    }

    const filteredRoot = filterCollapsed(root)
    const hierarchy = d3.hierarchy(filteredRoot)
    
    // Tree layout - horizontal orientation
    const treeLayout = d3.tree()
      .size([height - margin.top - margin.bottom, width - margin.left - margin.right - 100])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2))

    const tree = treeLayout(hierarchy)

    // Links with smooth curves
    const links = g.append('g')
      .attr('fill', 'none')
      .attr('stroke-linecap', 'round')
      .selectAll('path')
      .data(tree.links())
      .join('path')
      .attr('stroke', d => d.target.data.color || d.source.data.color || '#c9a96e')
      .attr('stroke-opacity', 0)
      .attr('stroke-width', d => d.target.depth === 1 ? 3 : 1.5)
      .attr('d', d3.linkHorizontal()
        .x(d => d.y)
        .y(d => d.x))
      .transition()
      .duration(600)
      .attr('stroke-opacity', d => d.target.depth === 1 ? 0.6 : 0.4)

    // Nodes group
    const node = g.append('g')
      .selectAll('g')
      .data(tree.descendants())
      .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .attr('opacity', 0)
      .style('cursor', d => (d.depth > 0 && d.data._children) || d.children ? 'pointer' : 'default')
      .on('click', (event, d) => {
        if (d.depth > 0 && (d.children || d.data._children)) {
          event.stopPropagation()
          toggleNode(d.data.id)
        }
      })

    // Animate node entrance
    node.transition()
      .duration(600)
      .delay((d, i) => i * 20)
      .attr('opacity', 1)

    // Expandir/contraer botón para nodos con hijos
    const nodeWithChildren = node.filter(d => d.depth === 1 && (d.children || d.data._children))
    
    nodeWithChildren.append('circle')
      .attr('r', 12)
      .attr('fill', 'white')
      .attr('stroke', d => d.data.color || '#c9a96e')
      .attr('stroke-width', 2.5)
      .attr('cx', -18)
      .attr('cy', 0)
      .style('cursor', 'pointer')
      .on('mouseenter', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', 14)
          .attr('stroke-width', 3)
      })
      .on('mouseleave', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', 12)
          .attr('stroke-width', 2.5)
      })

    nodeWithChildren.append('text')
      .attr('x', -18)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 16)
      .attr('font-weight', 'bold')
      .attr('fill', d => d.data.color || '#c9a96e')
      .text(d => collapsedNodes.has(d.data.id) ? '+' : '−')
      .style('pointer-events', 'none')

    // Fondo blanco para textos (mejor legibilidad)
    node.each(function(d) {
      const textNode = d3.select(this)
      const text = d.data.name || ''
      const maxLen = d.depth === 0 ? 40 : d.depth === 1 ? 35 : 30
      const displayText = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text
      
      // Calcular ancho aproximado del texto
      const textWidth = displayText.length * (d.depth === 0 ? 9 : d.depth === 1 ? 8 : 7)
      const padding = 8
      const xOffset = d.children || d.data._children ? -12 - padding : 12 + padding
      
      // Fondo blanco
      textNode.append('rect')
        .attr('x', d.children || d.data._children ? xOffset - textWidth : xOffset)
        .attr('y', -14)
        .attr('width', textWidth + padding * 2)
        .attr('height', 28)
        .attr('rx', 6)
        .attr('fill', 'white')
        .attr('fill-opacity', 0.95)
        .attr('stroke', d.depth === 0 ? '#c9a96e' : d.depth === 1 ? (d.data.color || '#e0e0e0') : '#e0e0e0')
        .attr('stroke-width', d.depth === 0 ? 2 : 1.5)
        .style('filter', d.depth === 0 ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' : 'none')
    })

    // Node circles con glow effect
    node.append('circle')
      .attr('fill', d => {
        if (d.depth === 0) return '#0d0d0d'
        if (d.depth === 1) return d.data.color || '#c9a96e'
        return d.data.leaf ? '#f8f9fa' : d.parent.data.color || '#c9a96e'
      })
      .attr('r', d => d.depth === 0 ? 8 : d.depth === 1 ? 6 : 4)
      .attr('stroke', d => {
        if (d.depth === 0) return '#c9a96e'
        if (d.depth === 1) return d.data.color || '#c9a96e'
        return 'white'
      })
      .attr('stroke-width', d => d.depth === 0 ? 3 : 2)
      .attr('filter', d => d.depth <= 1 ? 'url(#glow)' : null)
      .on('mouseenter', function(event, d) {
        if (d.children || d.data._children) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr('r', d => d.depth === 0 ? 10 : d.depth === 1 ? 8 : 5)
        }
      })
      .on('mouseleave', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', d => d.depth === 0 ? 8 : d.depth === 1 ? 6 : 4)
      })

    // Node labels
    node.append('text')
      .attr('dy', '0.31em')
      .attr('x', d => d.children || d.data._children ? -12 : 12)
      .attr('text-anchor', d => d.children || d.data._children ? 'end' : 'start')
      .attr('font-size', d => d.depth === 0 ? 14 : d.depth === 1 ? 12 : 10)
      .attr('font-weight', d => d.depth <= 1 ? '600' : '400')
      .attr('fill', d => d.depth === 0 ? '#0d0d0d' : d.depth === 1 ? (d.data.color || '#0d0d0d') : '#495057')
      .text(d => {
        const name = d.data.name || ''
        const maxLen = d.depth === 0 ? 40 : d.depth === 1 ? 35 : 30
        return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name
      })
      .style('text-shadow', d => d.depth === 0 ? '0 0 8px rgba(255,255,255,0.8)' : 'none')

    // Tooltips para textos completos
    node.append('title')
      .text(d => d.data.name || '')

    // Glow filter para nodos centrales
    const defs = svg.append('defs')
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%')

    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur')

    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Enhanced zoom and pan
    const zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', e => {
        g.attr('transform', `translate(${margin.left + e.transform.x},${margin.top + e.transform.y}) scale(${e.transform.k})`)
      })

    svg.call(zoom)

    // Reset view button
    const resetBtn = svg.append('g')
      .attr('transform', 'translate(20, 20)')
      .style('cursor', 'pointer')
      .on('click', () => {
        svg.transition()
          .duration(750)
          .call(zoom.transform, d3.zoomIdentity)
      })

    resetBtn.append('rect')
      .attr('width', 80)
      .attr('height', 32)
      .attr('rx', 6)
      .attr('fill', 'white')
      .attr('stroke', '#dee2e6')
      .attr('stroke-width', 1)
      .style('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))')

    resetBtn.append('text')
      .attr('x', 40)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', '#495057')
      .text('Centrar')

  }, [data, collapsedNodes, isFullscreen])

  if (!data) return null

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem'
      }}>
        <div>
          <h2 style={{ marginBottom: '0.25rem' }}>Mapa mental interactivo</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--mist)' }}>
            Haz clic en los botones <strong>+/−</strong> para expandir/colapsar · Arrastra y usa zoom
          </p>
        </div>
        <button
          onClick={toggleFullscreen}
          style={{
            background: 'var(--gold)',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '0.5rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.9rem',
            color: 'var(--ink)',
            fontWeight: '500'
          }}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {isFullscreen ? 'Salir' : 'Pantalla completa'}
        </button>
      </div>
      <div
        ref={ref}
        style={{
          width: '100%',
          height: isFullscreen ? 'calc(100vh - 100px)' : 600,
          background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
          border: '2px solid var(--paper-dark)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: isFullscreen ? 'var(--shadow-xl)' : 'var(--shadow)',
          position: isFullscreen ? 'fixed' : 'relative',
          top: isFullscreen ? '50px' : 'auto',
          left: isFullscreen ? '0' : 'auto',
          right: isFullscreen ? '0' : 'auto',
          zIndex: isFullscreen ? 1000 : 'auto',
        }}
      />
    </div>
  )
}
