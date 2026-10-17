import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import schemaJson from '@schema/legacy/ntb-v1.schema.json'

const ajv = new Ajv2020({ strict: true, allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schemaJson)

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/** Validates a parsed .ntb.json document against schema/ntb.schema.json. */
export function validateProjectFile(doc: unknown): ValidationResult {
  const ok = validate(doc) as boolean
  return {
    ok,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`.trim()),
  }
}
