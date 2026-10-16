import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { vi } from './vi'

/** Same keys as vi.ts with any string values (lets en.ts be type-checked for missing keys). */
type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
export type Strings = Widen<typeof vi>

export const LANGUAGE_KEY = 'ntb-lang'

function initialLanguage(): 'vi' | 'en' {
  const saved = globalThis.localStorage?.getItem(LANGUAGE_KEY)
  return saved === 'en' ? 'en' : 'vi'
}

// Synchronous init: resources are bundled, so the first render already has translations.
void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'vi',
  interpolation: { escapeValue: false }, // React escapes output
  initAsync: false,
})

/** Switches the UI language, remembers it per browser and keeps <html lang> in sync (screen readers). */
export function setLanguage(lang: 'vi' | 'en'): void {
  globalThis.localStorage?.setItem(LANGUAGE_KEY, lang)
  void i18n.changeLanguage(lang)
}

i18n.on('languageChanged', (lng) => {
  if (globalThis.document) document.documentElement.lang = lng
})
if (globalThis.document) document.documentElement.lang = i18n.language

export default i18n
