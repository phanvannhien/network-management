import { createDevice } from '../model/factory'
import type { Device } from '../../types/ntb'
import { getTemplate } from './catalog'
import { generateInterfaces } from './types'

/**
 * Creates a device from a catalog template, generating the default port
 * layout (SRS §2, e.g. L2 switch = 24×RJ45 + 4×SFP).
 */
export function createDeviceFromTemplate(
  typeId: Parameters<typeof getTemplate>[0],
  hostname: string,
): Device {
  const template = getTemplate(typeId)
  return {
    ...createDevice({
      type: template.typeId,
      hostname,
      vendor: template.defaultVendor,
      model: template.defaultModel,
    }),
    interfaces: generateInterfaces(template.portRuns),
  }
}
