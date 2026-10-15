// In-app model state, derived from the generated schema types (schema/ntb.schema.json
// is the source of truth). Entities are keyed by id for O(1) lookup; conversion to and
// from the array-based .ntb.json file format lives in io.ts.
import type { Asset, Device, Group, Link, Page, Project, Subnet, Vlan } from '../types/ntb'

export type {
  Asset,
  Device,
  Edge,
  Endpoint,
  Group,
  Interface,
  Link,
  Page,
  Project,
  Subnet,
  Vlan,
} from '../types/ntb'

export interface NtbData {
  project: Project
  vlans: Record<string, Vlan>
  subnets: Record<string, Subnet>
  devices: Record<string, Device>
  links: Record<string, Link>
  groups: Record<string, Group>
  assets: Record<string, Asset>
  pages: Record<string, Page>
  /** Page display order; pages not listed are kept at the end. */
  pageOrder: string[]
}

export function emptyData(): NtbData {
  return {
    project: {
      id: crypto.randomUUID(),
      name: 'Untitled',
      author: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    vlans: {},
    subnets: {},
    devices: {},
    links: {},
    groups: {},
    assets: {},
    pages: {},
    pageOrder: [],
  }
}
