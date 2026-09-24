'use client'

// Small building blocks shared by every form in the app, so sections, toggles
// and unit-suffixed inputs look and behave the same everywhere.

import type { ReactNode } from 'react'
import { useI18n } from '@/components/language-provider'
import type { Icon } from '@/lib/ui'

export function FormSection({ icon: SectionIcon, title, hint, optional, children }: { icon: Icon; title: string; hint?: string; optional?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="form-section">
      <div className="form-section-head">
        <span className="form-section-icon"><SectionIcon /></span>
        <div>
          <h3>
            {title}
            {optional && <em>{t('field.optional')}</em>}
          </h3>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T | ''
  options: { value: T; label: string; icon?: Icon; tone?: string }[]
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const OptionIcon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`${value === o.value ? 'seg selected' : 'seg'}${o.tone ? ` ${o.tone}` : ''}`}
            onClick={() => onChange(o.value)}
          >
            {OptionIcon && <OptionIcon />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function UnitInput({ value, onChange, unit, placeholder, step = 'any', min = 0 }: {
  value: string
  onChange: (value: string) => void
  unit: string
  placeholder?: string
  step?: string
  min?: number
}) {
  return (
    <span className="unit-input">
      <input type="number" inputMode="decimal" min={min} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {unit && <em>{unit}</em>}
    </span>
  )
}
