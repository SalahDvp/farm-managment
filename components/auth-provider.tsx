'use client'

// Tracks the Firebase Auth user in the browser. `status` is 'disabled' when
// Firebase isn't configured (demo mode — no accounts).

import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth'
import { firebaseConfigured, getClientAuth } from '@/lib/firebase-client'

type AuthStatus = 'disabled' | 'loading' | 'signed-in' | 'signed-out'

type AuthContextValue = { status: AuthStatus; user: User | null }

const AuthContext = createContext<AuthContextValue>({ status: 'loading', user: null })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<AuthContextValue>({ status: firebaseConfigured ? 'loading' : 'disabled', user: null })

  useEffect(() => {
    const auth = getClientAuth()
    if (!auth) return
    return onAuthStateChanged(auth, (user) => setValue({ status: user ? 'signed-in' : 'signed-out', user }))
  }, [])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

export async function signOut(): Promise<void> {
  const auth = getClientAuth()
  if (auth) await firebaseSignOut(auth).catch(() => {})
  // Full reload so no cached farm data survives into the next session.
  window.location.assign('/login')
}
