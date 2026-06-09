'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { AffectedFile } from '../hooks/useRiskRadar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Node {
  id: string;
  label: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'target';
  isTarget?: boolean;
  // d3 simulation fields (mutated in-place)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string | Node;
  target: string | Node;
}

interface DependencyGraphProps {
  affectedFiles: AffectedFile[];
  targetFile: string | null;
  onNodeClick?: (filePath: string) => void;
}

// ─── Risk colour map ──────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  target:   '#7c3aed',
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DependencyGraph({
  affectedFiles,
  targetFile,
  onNodeClick,
}: DependencyGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Only render for ≤10 affected files
  if (!affectedFiles || affectedFiles.length === 0 || affectedFiles.length > 10) {
    return null;
  }

  useEffect(() => {
    if (!svgRef.current || !affectedFiles.length) return;

    const width  = 400;
    const height = 260;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Build graph data ────────────────────────────────────────────────────

    const nodeMap = new Map<string, Node>();

    // Target node (pinned to centre)
    if (targetFile) {
      nodeMap.set(targetFile, {
        id:       targetFile,
        label:    targetFile.split('/').pop() || targetFile,
        riskLevel: 'target',
        isTarget: true,
        fx: width / 2,
        fy: height / 2,
      });
    }

    // Affected file nodes
    for (const file of affectedFiles) {
      if (!nodeMap.has(file.path)) {
        nodeMap.set(file.path, {
          id:       file.path,
          label:    file.path.split('/').pop() || file.path,
          riskLevel: file.riskLevel || 'low',
          isTarget: false,
        });
      }
    }

    const nodes: Node[] = Array.from(nodeMap.values());

    // Build edges (use file.dependsOn if present, else link to targetFile)
    const addedLinks = new Set<string>();
    const links: Link[] = [];

    for (const file of affectedFiles) {
      const linkTarget = (file as any).dependsOn || targetFile;
      if (linkTarget && nodeMap.has(linkTarget) && nodeMap.has(file.path)) {
        const key = `${file.path}->${linkTarget}`;
        if (!addedLinks.has(key)) {
          links.push({ source: file.path, target: linkTarget });
          addedLinks.add(key);
        }
      }
    }

    // ── Arrow marker ────────────────────────────────────────────────────────

    svg.append('defs').append('marker')
      .attr('id', 'dg-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(124,58,237,0.5)');

    // ── Force simulation ────────────────────────────────────────────────────

    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links)
        .id((d) => d.id)
        .distance(90)
      )
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(36));

    // ── Draw links ──────────────────────────────────────────────────────────

    const linkSel = svg.append('g')
      .selectAll<SVGLineElement, Link>('line')
      .data(links)
      .join('line')
      .attr('stroke', 'rgba(124,58,237,0.3)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#dg-arrow)');

    // ── Draw nodes ──────────────────────────────────────────────────────────

    const nodeSel = svg.append('g')
      .selectAll<SVGGElement, Node>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => {
        if (onNodeClick && !d.isTarget) onNodeClick(d.id);
      })
      .call(
        d3.drag<SVGGElement, Node>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            if (!d.isTarget) { d.fx = null; d.fy = null; }
          })
      );

    // Glow ring behind target node
    nodeSel.filter((d) => !!d.isTarget)
      .append('circle')
      .attr('r', 22)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(124,58,237,0.35)')
      .attr('stroke-width', 3);

    // Main circle
    nodeSel.append('circle')
      .attr('r', (d) => d.isTarget ? 14 : 9)
      .attr('fill', (d) => RISK_COLORS[d.riskLevel] || '#6b7280')
      .attr('fill-opacity', (d) => d.isTarget ? 1 : 0.85)
      .attr('stroke', (d) => d.isTarget
        ? 'rgba(196,181,253,0.8)'
        : 'rgba(255,255,255,0.12)'
      )
      .attr('stroke-width', (d) => d.isTarget ? 2.5 : 1);

    // Label
    nodeSel.append('text')
      .text((d) => {
        const lbl = d.label || d.id;
        return lbl.length > 14 ? lbl.slice(0, 13) + '…' : lbl;
      })
      .attr('x', 0)
      .attr('y', (d) => d.isTarget ? 28 : 21)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('fill', (d) => d.isTarget ? '#e9d5ff' : '#9ca3af');

    // Tooltip
    nodeSel.append('title')
      .text((d) => `${d.id}\nRisk: ${d.riskLevel}`);

    // ── Tick handler ────────────────────────────────────────────────────────

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as Node).x ?? 0)
        .attr('y1', (d) => (d.source as Node).y ?? 0)
        .attr('x2', (d) => (d.target as Node).x ?? 0)
        .attr('y2', (d) => (d.target as Node).y ?? 0);

      nodeSel.attr('transform', (d) =>
        `translate(${
          Math.max(22, Math.min(width - 22, d.x ?? width / 2))
        },${
          Math.max(22, Math.min(height - 22, d.y ?? height / 2))
        })`
      );
    });

    return () => { simulation.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affectedFiles, targetFile]);

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        background: 'rgba(6,6,10,0.6)',
        border: '1px solid rgba(124,58,237,0.15)',
        height: '260px',
      }}
    >
      {/* Legend */}
      <div className="absolute top-2 left-3 z-10 flex items-center gap-3">
        {[
          { label: 'Target',   color: '#7c3aed' },
          { label: 'Critical', color: '#ef4444' },
          { label: 'High',     color: '#f97316' },
          { label: 'Medium',   color: '#eab308' },
          { label: 'Low',      color: '#22c55e' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[9px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="260"
        viewBox="0 0 400 260"
        style={{ background: 'transparent' }}
      />
    </div>
  );
}
