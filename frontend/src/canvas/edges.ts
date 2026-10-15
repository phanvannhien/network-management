import type { CSSProperties } from 'react'
import type { Link } from '../types/ntb'

/** Stroke color per link status (SRS §4: Up xanh / Down đỏ / Admin down–Planned xám). */
function colorFor(status: Link['status']): string {
  switch (status) {
    case 'up':
      return '#16a34a'
    case 'down':
      return '#dc2626'
    default:
      return '#94a3b8' // admin_down / planned
  }
}

/** Dash pattern per link kind (SRS §4: liền / đứt / chấm); undefined = solid. */
function dashFor(kind: Link['kind']): string | undefined {
  switch (kind) {
    case 'wireless':
      return '5 4'
    case 'serial':
      return '2 3'
    case 'logical':
      return '7 5'
    case 'console':
      return '1 4'
    default:
      return undefined // ethernet and fiber are solid (fiber is thicker instead)
  }
}

export interface EdgeVisual {
  style: CSSProperties
}

/** Maps a link's kind + status to the React Flow edge style. */
export function edgeVisual(link: Pick<Link, 'kind' | 'status'>): EdgeVisual {
  return {
    style: {
      stroke: colorFor(link.status),
      strokeWidth: link.kind === 'fiber' ? 3 : 1.5,
      strokeDasharray: dashFor(link.kind),
    },
  }
}

/**
 * Curvature per index among parallel links (same unordered endpoint pair) so
 * multiple links between two devices don't overlap (SRS §4: link song song tự tách).
 */
export function parallelCurvature(index: number): number {
  if (index === 0) return 0.25
  return 0.25 + index * 0.15
}
