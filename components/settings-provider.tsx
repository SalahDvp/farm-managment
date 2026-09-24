'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type Accent = 'terracotta' | 'olive' | 'wheat' | 'plum' | 'sky'

export interface Settings {
  farmName: string
  managerName: string
  role: string
  accent: Accent
  /** ISO 4217 code used for prices and costs. */
  currency: string
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'MAD', 'DZD', 'TND', 'EGP', 'SAR', 'AED'] as const

export const ACCENTS: Record<Accent, { clay: string; clay600: string; clay050: string }> = {
  terracotta: { clay: '#c15f3c', clay600: '#a94e2e', clay050: '#f6ddcf' },
  olive: { clay: '#6d7a37', clay600: '#59642c', clay050: '#e9edd2' },
  wheat: { clay: '#c8912f', clay600: '#a97722', clay050: '#f7e7c6' },
  plum: { clay: '#8a6f8e', clay600: '#6f5873', clay050: '#efe3ef' },
  sky: { clay: '#4f8a97', clay600: '#3f7280', clay050: '#dcebec' },
}

export const DEFAULT_SETTINGS: Settings = {
  farmName: 'Meadow Farm',
  managerName: 'Jordan Miller',
  role: 'Farm manager',
  accent: 'terracotta',
  currency: 'USD',
}

export const SETTINGS_KEY = 'fieldwise.settings'

function applyAccent(accent: Accent) {
  const a = ACCENTS[accent] ?? ACCENTS.terracotta
  const root = document.documentElement.style
  root.setProperty('--clay', a.clay)
  root.setProperty('--clay-600', a.clay600)
  root.setProperty('--clay-050', a.clay050)
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type SettingsContextValue = {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
  initials: string
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function save(next: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    applyAccent(settings.accent)
  }, [settings.accent])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    save(DEFAULT_SETTINGS)
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update, reset, initials: initialsFrom(settings.managerName) }),
    [settings, update, reset],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within <SettingsProvider>')
  return ctx
}
