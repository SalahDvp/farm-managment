'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_LOCALE,
  dirFor,
  LOCALES,
  STORAGE_KEY,
  translate,
  type Dir,
  type Locale,
} from '@/lib/i18n'

type I18nContextValue = {
  locale: Locale
  dir: Dir
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Start from the default so the server and first client render match (no
  // hydration mismatch); load the saved preference right after mount.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
      if (saved && LOCALES.some((l) => l.code === saved)) setLocaleState(saved)
    } catch {
      /* localStorage may be unavailable */
    }
  }, [])

  const dir = dirFor(locale)

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, dir, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <LanguageProvider>')
  return ctx
}
