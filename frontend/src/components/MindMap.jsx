import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Maximize2, Minimize2 } from 'lucide-react'

export default function MindMap({ data }) {
  const ref = useRef()
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Track which branch-level nodes are expanded (by index)
  // Start with none expanded — user opens them one by one
  const [expandedBranches, setExpandedBranches] = useState(new Set())

  const toggleFullscreen = () => setIsFullscreen(f => !f)

  // Expand a branch by its index
  const expandBranch = useCallback((branchIdx) => {
    setExpandedBranches(prev => {
      const next = new Set(prev)
      if (next.has(branchIdx)) {
        next.delete(branchIdx)
      } else {
        next.add(branchIdx)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!data || !ref.current) return
    const el = ref.current
    el.innerHTML = ''

    const branches = data.branches || []
    const width = el.clientWidth || 900
    const height = isFullscreen ? window.innerHeight - 100 : 580

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', 'var(--font-body)')
      .style('background', 'linear-gradient(135deg, #fafafa 0%, #f5f0e8 100%)')
      .style('cursor', 'grab')
      .on('mousedown', function () { d3.select(this).style('cursor', 'grabbing') })
      .on('mouseup', function () { d3.select(this).style('cursor', 'grab') })

    // Defs (glow + arrow)
    const defs = svg.append('defs')
    const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur')
    const feMerge = glowFilter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const g = svg.append('g')

    // Zoom & pan
    const zoom = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', e => {
        g.attr('transform', e.transform)
      })
    svg.call(zoom)

    // Initial transform — center the root
    const initX = width * 0.16
    const initY = height / 2
    svg.call(zoom.transform, d3.zoomIdentity.translate(initX, initY))

    // Layout constants
    const BRANCH_SPACING = 52    // vertical space between branch nodes
    const ROOT_X = 0
    const ROOT_Y = 0
    const BRANCH_X = 180         // x of branch nodes (level 1)
    const LEAF_X = 380           // x of leaf nodes (level 2)
    const LEAF_SPACING = 26      // vertical space between leaves

    // Position branches evenly around center
    const branchCount = branches.length
    const totalBranchHeight = (branchCount - 1) * BRANCH_SPACING
    const branchPositions = branches.map((_, i) => ({
      x: BRANCH_X,
      y: ROOT_Y - totalBranchHeight / 2 + i * BRANCH_SPACING
    }))

    // Draw root node
    const rootG = g.append('g').attr('transform', `translate(${ROOT_X},${ROOT_Y})`)

    rootG.append('circle')
      .attr('r', 28)
      .attr('fill', '#0d0d0d')
      .attr('stroke', '#c9a96e')
      .attr('stroke-width', 3)
      .attr('filter', 'url(#glow)')

    // Root label (wrapped)
    const rootLabel = data.center || ''
    const rootWords = rootLabel.split(' ')
    const rootLines = []
    let line = ''
    rootWords.forEach(w => {
      if ((line + ' ' + w).trim().length > 14) { rootLines.push(line.trim()); line = w }
      else { line = (line + ' ' + w).trim() }
    })
    if (line) rootLines.push(line)

    rootLines.forEach((l, i) => {
      rootG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', `${(i - (rootLines.length - 1) / 2) * 1.15}em`)
        .attr('fill', '#c9a96e')
        .attr('font-size', 11)
        .attr('font-weight', '600')
        .text(l)
    })

    // Draw each branch
    branches.forEach((branch, bi) => {
      const bPos = branchPositions[bi]
      const color = branch.color || '#c9a96e'
      const isExpanded = expandedBranches.has(bi)
      const children = branch.children || []

      // Connector root → branch
      const linkG = g.append('g').attr('class', `branch-link-${bi}`)
      linkG.append('path')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.55)
        .attr('d', () => {
          const sx = ROOT_X + 28, sy = ROOT_Y
          const tx = bPos.x - 18, ty = bPos.y
          const mx = (sx + tx) / 2
          return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`
        })
        .style('transition', 'stroke-opacity 0.3s')

      // Branch node group
      const branchG = g.append('g')
        .attr('class', `branch-node-${bi}`)
        .attr('transform', `translate(${bPos.x},${bPos.y})`)
        .style('cursor', 'pointer')
        .on('click', () => expandBranch(bi))

      // Branch background pill
      const labelText = branch.label || ''
      const labelLen = Math.min(labelText.length, 22)
      const pillW = Math.max(90, labelLen * 7 + 28)

      branchG.append('rect')
        .attr('x', -pillW / 2)
        .attr('y', -14)
        .attr('width', pillW)
        .attr('height', 28)
        .attr('rx', 14)
        .attr('fill', 'white')
        .attr('stroke', color)
        .attr('stroke-width', isExpanded ? 2.5 : 1.5)
        .attr('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))')
        .style('transition', 'stroke-width 0.2s')

      // Expand/collapse indicator on left
      branchG.append('circle')
        .attr('cx', -pillW / 2 - 12)
        .attr('cy', 0)
        .attr('r', 8)
        .attr('fill', isExpanded ? color : 'white')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)

      branchG.append('text')
        .attr('x', -pillW / 2 - 12)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .attr('fill', isExpanded ? 'white' : color)
        .text(isExpanded ? '−' : '+')
        .style('pointer-events', 'none')

      // Branch label
      branchG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', 11)
        .attr('font-weight', '600')
        .attr('fill', color)
        .text(labelText.length > 22 ? labelText.slice(0, 21) + '…' : labelText)
        .style('pointer-events', 'none')

      // Child count badge
      if (children.length && !isExpanded) {
        branchG.append('circle')
          .attr('cx', pillW / 2 + 10)
          .attr('cy', 0)
          .attr('r', 9)
          .attr('fill', color)
          .attr('fill-opacity', 0.15)
          .attr('stroke', color)
          .attr('stroke-width', 1)

        branchG.append('text')
          .attr('x', pillW / 2 + 10)
          .attr('y', 0)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', 9)
          .attr('fill', color)
          .text(children.length)
          .style('pointer-events', 'none')
      }

      // Leaves (shown only when expanded)
      if (isExpanded && children.length > 0) {
        const totalLeavesH = (children.length - 1) * LEAF_SPACING
        children.forEach((childText, ci) => {
          const leafY = bPos.y - totalLeavesH / 2 + ci * LEAF_SPACING
          const leafX = LEAF_X

          // Connector branch → leaf
          g.append('path')
            .attr('class', `leaf-link-${bi}-${ci}`)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.2)
            .attr('stroke-opacity', 0)
            .attr('d', () => {
              const sx = bPos.x + pillW / 2, sy = bPos.y
              const tx = leafX - 6, ty = leafY
              const mx = (sx + tx) / 2
              return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`
            })
            .transition()
            .duration(300)
            .delay(ci * 40)
            .attr('stroke-opacity', 0.35)

          // Leaf node
          const leafG = g.append('g')
            .attr('class', `leaf-node-${bi}-${ci}`)
            .attr('transform', `translate(${leafX},${leafY})`)
            .attr('opacity', 0)

          leafG.transition()
            .duration(300)
            .delay(ci * 40)
            .attr('opacity', 1)

          const leafText = typeof childText === 'string' ? childText : ''
          const truncated = leafText.length > 48 ? leafText.slice(0, 47) + '…' : leafText
          const leafW = Math.max(80, Math.min(truncated.length * 6.5 + 20, 220))

          leafG.append('rect')
            .attr('x', 0)
            .attr('y', -11)
            .attr('width', leafW)
            .attr('height', 22)
            .attr('rx', 5)
            .attr('fill', 'white')
            .attr('stroke', color)
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.4)
            .attr('filter', 'drop-shadow(0 1px 3px rgba(0,0,0,0.06))')

          leafG.append('text')
            .attr('x', 8)
            .attr('y', 0)
            .attr('dominant-baseline', 'central')
            .attr('font-size', 9.5)
            .attr('fill', '#333')
            .text(truncated)

          // Tooltip for full text
          leafG.append('title').text(leafText)
        })
      }
    })

    // Reset view button
    const resetBtn = svg.append('g')
      .attr('transform', 'translate(16, 16)')
      .style('cursor', 'pointer')
      .on('click', () => {
        svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(initX, initY))
      })

    resetBtn.append('rect')
      .attr('width', 72)
      .attr('height', 28)
      .attr('rx', 6)
      .attr('fill', 'white')
      .attr('stroke', '#dee2e6')
      .attr('stroke-width', 1)
      .attr('filter', 'drop-shadow(0 1px 4px rgba(0,0,0,0.08))')

    resetBtn.append('text')
      .attr('x', 36).attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', '#495057')
      .text('Centrar')

  }, [data, expandedBranches, isFullscreen])

  if (!data) return null

  const branches = data.branches || []
  const totalExpanded = expandedBranches.size

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ marginBottom: '0.25rem' }}>Mapa mental interactivo</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--mist)', lineHeight: 1.5 }}>
            Pulsa <strong>+</strong> en cada rama para desplegar sus nodos · Arrastra y usa el scroll para navegar
          </p>
          {branches.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {branches.map((b, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setExpandedBranches(prev => {
                      const next = new Set(prev)
                      if (next.has(i)) next.delete(i)
                      else next.add(i)
                      return next
                    })
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    border: `1.5px solid ${b.color || '#c9a96e'}`,
                    background: expandedBranches.has(i) ? (b.color || '#c9a96e') : 'white',
                    color: expandedBranches.has(i) ? 'white' : (b.color || '#c9a96e'),
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <span style={{ fontSize: '0.7rem' }}>{expandedBranches.has(i) ? '−' : '+'}</span>
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {totalExpanded > 0 && (
            <button
              onClick={() => setExpandedBranches(new Set())}
              style={{ background: 'none', border: '1.5px solid var(--paper-dark)', borderRadius: 'var(--radius)', padding: '0.4rem 0.85rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--slate)' }}
            >
              Colapsar todo
            </button>
          )}
          {totalExpanded < branches.length && (
            <button
              onClick={() => setExpandedBranches(new Set(branches.map((_, i) => i)))}
              style={{ background: 'none', border: '1.5px solid var(--paper-dark)', borderRadius: 'var(--radius)', padding: '0.4rem 0.85rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--slate)' }}
            >
              Expandir todo
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'var(--gold)', border: 'none', borderRadius: 'var(--radius)',
              padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
              cursor: 'pointer', fontSize: '0.85rem', color: 'var(--ink)', fontWeight: 500
            }}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {isFullscreen ? 'Salir' : 'Pantalla completa'}
          </button>
        </div>
      </div>

      <div
        ref={ref}
        style={{
          width: '100%',
          height: isFullscreen ? 'calc(100vh - 100px)' : 580,
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
