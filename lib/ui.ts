// Presentation helpers shared by the client components: icon + tone metadata,
// number/date/money formatting, and due-date logic for tasks.

import {
  Axe,
  Boxes,
  ClipboardList,
  Droplets,
  FlaskConical,
  Leaf,
  PawPrint,
  Pill,
  Recycle,
  Scale,
  Scissors,
  SprayCan,
  Stethoscope,
  StickyNote,
  Syringe,
  TreePine,
  Wheat,
  Wrench,
} from 'lucide-react'
import type { ItemType, LogKind, TaskType } from '@/lib/farm-types'
import { dict, type Locale } from '@/lib/i18n'
import { apiFetch } from '@/lib/client-api'

export type Icon = typeof Leaf
export type Translate = (key: string, vars?: Record<string, string | number>) => string

export const KIND_META: Record<LogKind, { icon: Icon; tone: string }> = {
  water: { icon: Droplets, tone: 'blue' },
  manure: { icon: Recycle, tone: 'brown' },
  feed: { icon: Wheat, tone: 'amber' },
  fertilizer: { icon: FlaskConical, tone: 'green' },
  medicine: { icon: Pill, tone: 'rose' },
  vaccination: { icon: Syringe, tone: 'violet' },
  'health-check': { icon: Stethoscope, tone: 'teal' },
  harvest: { icon: Scissors, tone: 'green' },
  weight: { icon: Scale, tone: 'violet' },
  spray: { icon: SprayCan, tone: 'teal' },
  pruning: { icon: Axe, tone: 'brown' },
  note: { icon: StickyNote, tone: 'gray' },
}

export const TYPE_META: Record<ItemType, { icon: Icon; tone: string }> = {
  tree: { icon: TreePine, tone: 'green' },
  animal: { icon: PawPrint, tone: 'amber' },
  resource: { icon: Boxes, tone: 'blue' },
}

export const TASK_META: Record<TaskType, { icon: Icon; tone: string }> = {
  vaccination: { icon: Syringe, tone: 'violet' },
  feeding: { icon: Wheat, tone: 'amber' },
  watering: { icon: Droplets, tone: 'blue' },
  spraying: { icon: SprayCan, tone: 'teal' },
  fertilizing: { icon: FlaskConical, tone: 'green' },
  harvest: { icon: Scissors, tone: 'green' },
  'health-check': { icon: Stethoscope, tone: 'teal' },
  pruning: { icon: Axe, tone: 'brown' },
  shearing: { icon: Scissors, tone: 'gray' },
  maintenance: { icon: Wrench, tone: 'brown' },
  other: { icon: ClipboardList, tone: 'gray' },
}

export const kindLabel = (t: Translate, k: LogKind) => t(`kind.${k}`)
export const typeLabel = (t: Translate, type: ItemType) => t(`type.${type}`)

/**
 * Built-in word units (the defaults the app suggests) are translated with the
 * plural form for `n` — "1 tête" / "3 têtes", "5 رؤوس" / "20 رأس". Symbols
 * (kg, L, ha) and anything the user typed are shown as-is.
 */
export const WORD_UNITS = ['dose', 'head', 'trees', 'unit'] as const
export function unitLabel(locale: Locale, unit: string | undefined, n: number): string {
  if (!unit || !(WORD_UNITS as readonly string[]).includes(unit)) return unit ?? ''
  const table = dict[locale] ?? dict.en
  const form = new Intl.PluralRules(intlLocale(locale)).select(n)
  return table[`unit.${unit}.${form}`] ?? table[`unit.${unit}.other`] ?? dict.en[`unit.${unit}.other`] ?? unit
}

export const fetcher = (url: string) =>
  apiFetch(url).then((r) => {
    // Signed out (or the session ended): go sign in again.
    if (r.status === 401 && typeof window !== 'undefined') window.location.assign('/login')
    if (!r.ok) throw new Error(`Request failed: ${r.status}`)
    return r.json()
  })

/** Force Latin digits for Arabic so figures stay legible next to Latin units. */
export function intlLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : locale
}

export function fmt(n: number, locale: Locale, digits = 2): string {
  return n.toLocaleString(intlLocale(locale), { maximumFractionDigits: digits })
}

export function fmtMoney(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      maximumFractionDigits: amount !== 0 && Math.abs(amount) < 1 ? 3 : 2,
    }).format(amount)
  } catch {
    return `${fmt(amount, locale)} ${currency}`
  }
}

export function relativeTime(iso: string, t: Translate): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return t('time.justNow')
  if (min < 60) return t('time.minAgo', { n: min })
  const hr = Math.round(min / 60)
  if (hr < 24) return t('time.hrAgo', { n: hr })
  const day = Math.round(hr / 24)
  return day === 1 ? t('time.dayAgo', { n: 1 }) : t('time.daysAgo', { n: day })
}

/** Parse YYYY-MM-DD (or any ISO string) as a local calendar date. */
function localDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatDate(iso: string | undefined, locale: Locale): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? localDate(iso) : new Date(iso)
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(locale), { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Whole calendar days from today until the given date (negative = past). */
export function daysUntil(date: string, today = new Date()): number {
  const d = localDate(date)
  if (!d) return 0
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((d.getTime() - base.getTime()) / 86400000)
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'

export function dueInfo(date: string, t: Translate, locale: Locale): { label: string; state: DueState; days: number } {
  const days = daysUntil(date)
  if (days < 0) return { label: days === -1 ? t('due.yesterday') : t('due.overdueBy', { n: -days }), state: 'overdue', days }
  if (days === 0) return { label: t('due.today'), state: 'today', days }
  if (days === 1) return { label: t('due.tomorrow'), state: 'soon', days }
  if (days <= 7) return { label: t('due.inDays', { n: days }), state: 'soon', days }
  return { label: formatDate(date, locale), state: 'later', days }
}

/** "4 yr 7 mo" / "5 mo" from a birth or planting date. */
export function ageLabel(origin: string | undefined, t: Translate): string | null {
  if (!origin) return null
  const d = localDate(origin)
  if (!d) return null
  const now = new Date()
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (now.getDate() < d.getDate()) months -= 1
  if (months < 0) return null
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return t('age.months', { m: rest })
  return rest === 0 ? t('age.years', { y: years }) : t('age.yearsMonths', { y: years, m: rest })
}
