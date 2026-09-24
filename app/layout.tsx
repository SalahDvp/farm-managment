import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Cairo, Fraunces } from 'next/font/google'
import { AuthProvider } from '@/components/auth-provider'
import { ConfirmProvider } from '@/components/confirm-provider'
import { LanguageProvider } from '@/components/language-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ToastProvider } from '@/components/toast-provider'
import './globals.css'

// Warm, tactile pairing: an organic serif for display, a rounded sans for the
// UI. Cairo also carries Arabic glyphs, so RTL stays on-brand.
const fontBody = Cairo({ subsets: ['latin', 'arabic'], variable: '--font-body', display: 'swap' })
const fontDisplay = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' })

// Runs before hydration to apply the saved language + direction and accent
// color, avoiding a flash of the wrong direction or theme on load.
const bootstrap = `(function(){try{var l=localStorage.getItem('fieldwise.locale');if(l){document.documentElement.lang=l;document.documentElement.dir=(l==='ar'?'rtl':'ltr');}var A={terracotta:['#c15f3c','#a94e2e','#f6ddcf'],olive:['#6d7a37','#59642c','#e9edd2'],wheat:['#c8912f','#a97722','#f7e7c6'],plum:['#8a6f8e','#6f5873','#efe3ef'],sky:['#4f8a97','#3f7280','#dcebec']};var s=JSON.parse(localStorage.getItem('fieldwise.settings')||'{}');var a=A[s.accent];if(a){var r=document.documentElement.style;r.setProperty('--clay',a[0]);r.setProperty('--clay-600',a[1]);r.setProperty('--clay-050',a[2]);}}catch(e){}})();`

export const metadata: Metadata = {
  title: 'Fieldwise | Farm operations',
  description: 'Track every tree, animal, and farm resource with clear, organized records.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${fontBody.variable} ${fontDisplay.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
        <AuthProvider>
          <LanguageProvider>
            <SettingsProvider>
              <ToastProvider>
                <ConfirmProvider>{children}</ConfirmProvider>
              </ToastProvider>
            </SettingsProvider>
          </LanguageProvider>
        </AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
