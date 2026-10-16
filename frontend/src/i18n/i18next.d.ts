import 'i18next'
import type { vi } from './vi'

// Typed keys: t('devices.title') is checked at compile time against vi.ts.
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof vi }
  }
}
