import type { Command } from '../model/commands'
import { addDevice } from '../model/commands'
import type { NtbData } from '../model/types'
import { createDeviceFromTemplate } from '../catalog/createFromTemplate'
import { nextHostname } from '../catalog/hostname'
import type { DeviceType } from '../../types/ntb'

/**
 * Builds the command for dropping a palette item onto the canvas: creates a
 * device from the template with an auto-generated hostname and places its
 * view node at the drop position.
 */
export function deviceDropCommand(
  data: NtbData,
  pageId: string,
  typeId: DeviceType,
  x: number,
  y: number,
): Command {
  const device = createDeviceFromTemplate(typeId, nextHostname(data, typeId))
  return addDevice(device, pageId, x, y)
}
