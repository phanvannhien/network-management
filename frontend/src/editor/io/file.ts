import { fromNtbProjectFile, toNtbProjectFile } from '../model/io'
import type { NtbData } from '../model/types'
import { validateProjectFile } from './schemaValidate'

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9à-ỹ]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

/** Serializes the model to a .ntb.json download. */
export function downloadProjectFile(data: NtbData): void {
  const blob = new Blob([JSON.stringify(toNtbProjectFile(data), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${slug(data.project.name)}.ntb.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Reads and validates a .ntb.json file: ajv schema check first, then converts
 * to the keyed in-app model. Throws with a readable message on failure.
 */
export async function readProjectFile(file: File): Promise<NtbData> {
  const text = await file.text()
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('File không phải JSON hợp lệ')
  }
  const result = validateProjectFile(doc)
  if (!result.ok) {
    throw new Error(`File không đúng schema: ${result.errors[0] ?? 'lỗi không rõ'}`)
  }
  return fromNtbProjectFile(doc as Parameters<typeof fromNtbProjectFile>[0])
}
