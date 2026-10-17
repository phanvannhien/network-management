import { DeviceNode, GroupNode, RefNode } from './nodes'

/** React Flow node types; a stable object (recreating it per render makes React Flow warn). */
export const NODE_TYPES = { device: DeviceNode, group: GroupNode, ref: RefNode }
