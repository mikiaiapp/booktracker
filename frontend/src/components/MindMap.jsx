import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'

export default function MindMap({ data }) {
  const ref = useRef()

  useEffect(() => {
    if (!data || !ref.current) return
    const el = ref.current
    el.innerHTML = ''

    const width = el.clientWidth || 800
    const height = 560
    const cx = width / 2
    const cy = height / 2

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', 'var(--font-body)')

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`)

    // Build hierarchy
    const root = {
      name: data.center,
      children: (data.branches || []).map(b => ({
        name: b.label,
        color: b.color || '#6366f1',
        children: (b.children || []).map(c => ({ name: c, leaf: true }))
      }))
    }

    const hierarchy = d3.hierarchy(root)
    const treeLayout = d3.tree()
      .size([2 * Math.PI, Math.min(cx, cy) - 80])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)

    const tree = treeLayout(hierarchy)

    // Links
    g.append('g').attr('fill', 'none')
      .selectAll('path')
      .data(tree.links())
      .join('path')
      .attr('stroke', d => d.target.data.color || d.source.data.color || '#c9a96e')
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', d => d.target.depth === 1 ? 2 : 1)
      .attr('d', d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y))

    // Nodes
    const node = g.append('g')
      .selectAll('g')
      .data(tree.descendants())
      .join('g')
      .attr('transform', d => `rotate(${(d.x * 180 / Math.PI - 90)}) translate(${d.y},0)`)

    node.append('circle')
      .attr('fill', d => d.depth === 0 ? '#0d0d0d' : d.data.color || '#c9a96e')
      .attr('r', d => d.depth === 0 ? 10 : d.depth === 1 ? 6 : 4)
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5)

    node.append('text')
      .attr('dy', '0.31em')
      .attr('x', d => d.x < Math.PI === !d.children ? 8 : -8)
      .attr('text-anchor', d => d.x < Math.PI === !d.children ? 'start' : 'end')
      .attr('transform', d => d.x >= Math.PI ? 'rotate(180)' : null)
      .attr('font-size', d => d.depth === 0 ? 14 : d.depth === 1 ? 12 : 10)
      .attr('font-weight', d => d.depth <= 1 ? '500' : '400')
      .attr('fill', '#0d0d0d')
      .text(d => {
        const name = d.data.name || ''
        return name.length > 30 ? name.slice(0, 28) + '…' : name
      })

    // Zoom
    svg.call(d3.zoom()
      .scaleExtent([0.4, 2])
      .on('zoom', e => g.attr('transform', `translate(${cx},${cy}) scale(${e.transform.k}) translate(${e.transform.x / e.transform.k},${e.transform.y / e.transform.k})`))
    )
  }, [data])

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Mapa mental</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--mist)', marginBottom: '1rem' }}>
        Usa la rueda del ratón para hacer zoom · Arrastra para mover
      </p>
      <div
        ref={ref}
        style={{
          width: '100%',
          height: 560,
          background: 'var(--white)',
          border: '1.5px solid var(--paper-dark)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
