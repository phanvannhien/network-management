import { CableEdge } from './CableEdge'
import { ArrowNode, ClusterNode, FrameNode, TextNode } from './annotationNodes'
import { DeviceNode, GroupNode, RefNode } from './nodes'

/** React Flow node types; a stable object (recreating it per render makes React Flow warn). */
export const NODE_TYPES = {
  device: DeviceNode,
  group: GroupNode,
  ref: RefNode,
  frame: FrameNode,
  text: TextNode,
  arrow: ArrowNode,
  cluster: ClusterNode,
}

/** React Flow edge types (P1-17): every cable is a floating straight line. */
export const EDGE_TYPES = { cable: CableEdge }
