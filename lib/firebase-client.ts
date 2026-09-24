'use client'

// Browser Firebase: Auth for sign in / sign up, and Firestore for the farm
// data. Config comes from NEXT_PUBLIC_FIREBASE_* in .env.local — these values
// identify the project and are not secrets; access is enforced by Firebase
// Auth plus firestore.rules.
//
// Without this config the app runs on the server's in-memory demo store with
// no accounts.

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { initializeFirestore, type Firestore } from 'firebase/firestore'

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null

/** Firebase Auth + Firestore, or null when the web config is missing. */
export function getFirebase(): { auth: Auth; db: Firestore } | null {
  if (!firebaseConfigured) return null
  if (!cached) {
    const app = getApps()[0] ?? initializeApp(config)
    // Optional fields are left undefined throughout the domain model.
    const db = initializeFirestore(app, { ignoreUndefinedProperties: true })
    cached = { app, auth: getAuth(app), db }
  }
  return cached
}

export function getClientAuth(): Auth | null {
  return getFirebase()?.auth ?? null
}
