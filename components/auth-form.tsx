'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { Check, Eye, EyeOff, Leaf, Loader2, MailCheck, TriangleAlert } from 'lucide-react'
import { firebaseConfigured, getClientAuth } from '@/lib/firebase-client'
import { useAuth } from '@/components/auth-provider'
import { LOCALES } from '@/lib/i18n'
import { useI18n } from '@/components/language-provider'
import { useSettings } from '@/components/settings-provider'

type Mode = 'login' | 'signup'

const ERROR_KEYS: Record<string, string> = {
  'auth/invalid-credential': 'auth.err.invalid',
  'auth/invalid-login-credentials': 'auth.err.invalid',
  'auth/wrong-password': 'auth.err.invalid',
  'auth/user-not-found': 'auth.err.invalid',
  'auth/email-already-in-use': 'auth.err.emailInUse',
  'auth/weak-password': 'auth.err.weak',
  'auth/invalid-email': 'auth.err.email',
  'auth/missing-email': 'auth.err.email',
  'auth/too-many-requests': 'auth.err.tooMany',
  'auth/network-request-failed': 'auth.err.network',
  'auth/operation-not-allowed': 'auth.err.provider',
}

function errorKey(error: unknown): string {
  if (error instanceof FirebaseError) return ERROR_KEYS[error.code] ?? 'auth.err.generic'
  return 'auth.err.generic'
}

/** Only follow same-site relative redirects from ?next=. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function AuthForm({ mode }: { mode: Mode }) {
  const { t, locale, setLocale } = useI18n()
  const { update } = useSettings()
  const { status } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignup = mode === 'signup'

  // Already signed in, or no accounts in demo mode? Skip the form.
  useEffect(() => {
    if (status === 'disabled' || (status === 'signed-in' && !busy)) window.location.replace(nextPath())
  }, [status, busy])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const auth = getClientAuth()
    if (!auth) return setError(t('auth.err.notConfigured'))
    if (isSignup && !name.trim()) return setError(t('auth.err.name'))
    if (isSignup && password.length < 6) return setError(t('auth.err.weak'))

    setBusy(true)
    try {
      const cred = isSignup
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password)
      if (isSignup) await updateProfile(cred.user, { displayName: name.trim() })
      const displayName = cred.user.displayName?.trim()
      if (displayName) update({ managerName: displayName })
      window.location.assign(nextPath())
    } catch (err) {
      setError(err instanceof FirebaseError ? t(errorKey(err)) : err instanceof Error ? err.message : t('auth.err.generic'))
      setBusy(false)
    }
  }

  async function forgotPassword() {
    setError(null)
    setNotice(null)
    const auth = getClientAuth()
    if (!auth) return setError(t('auth.err.notConfigured'))
    if (!email.trim()) return setError(t('auth.resetNeedEmail'))
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setNotice(t('auth.resetSent', { email: email.trim() }))
    } catch (err) {
      // Don't reveal whether an account exists for this address.
      if (err instanceof FirebaseError && err.code === 'auth/user-not-found') setNotice(t('auth.resetSent', { email: email.trim() }))
      else setError(t(errorKey(err)))
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="brand">
          <div className="brand-mark"><Leaf /></div>
          <div className="brand-text"><strong>Fieldwise</strong><span>{t('app.tagline')}</span></div>
        </div>
        <div className="auth-aside-body">
          <h2>{t('auth.aside.title')}</h2>
          <ul>
            {['auth.aside.p1', 'auth.aside.p2', 'auth.aside.p3'].map((key) => (
              <li key={key}><span><Check /></span>{t(key)}</li>
            ))}
          </ul>
        </div>
        <div className="auth-rows" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <i key={i} />)}
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-lang" role="group" aria-label={t('lang.label')}>
          {LOCALES.map((l) => (
            <button key={l.code} className={l.code === locale ? 'active' : ''} onClick={() => setLocale(l.code)} aria-pressed={l.code === locale}>
              {l.short}
            </button>
          ))}
        </div>

        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="auth-card-brand">
            <div className="brand-mark sm"><Leaf /></div>
            <strong>Fieldwise</strong>
          </div>
          <h1>{t(isSignup ? 'auth.signUp.title' : 'auth.signIn.title')}</h1>
          <p className="auth-sub">{t(isSignup ? 'auth.signUp.sub' : 'auth.signIn.sub')}</p>

          {!firebaseConfigured && <p className="auth-alert warn"><TriangleAlert />{t('auth.err.notConfigured')}</p>}

          {isSignup && (
            <label className="auth-field">
              {t('auth.name')}
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
            </label>
          )}
          <label className="auth-field">
            {t('auth.email')}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required autoFocus={!isSignup} />
          </label>
          <label className="auth-field">
            <span className="auth-field-row">
              {t('auth.password')}
              {!isSignup && <button type="button" className="auth-link" onClick={forgotPassword}>{t('auth.forgot')}</button>}
            </span>
            <span className="auth-password">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}>
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </span>
            {isSignup && <small>{t('auth.passwordHint')}</small>}
          </label>

          {error && <p className="auth-alert" role="alert"><TriangleAlert />{error}</p>}
          {notice && <p className="auth-alert ok" role="status"><MailCheck />{notice}</p>}

          <button className="primary-button full auth-submit" disabled={busy}>
            {busy && <Loader2 className="spin" />}
            {t(isSignup ? 'auth.signUpCta' : 'auth.signInCta')}
          </button>

          <p className="auth-switch">
            {t(isSignup ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
            <Link href={isSignup ? '/login' : '/signup'}>{t(isSignup ? 'auth.toSignIn' : 'auth.toSignUp')}</Link>
          </p>
        </form>
      </main>
    </div>
  )
}
