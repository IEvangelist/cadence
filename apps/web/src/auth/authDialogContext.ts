import { createContext, useContext } from 'react'

export interface OpenAuthOptions {
  returnTarget?: string
  dismissTo?: string
}

export interface AuthDialogContextValue {
  openAuth: (options?: OpenAuthOptions) => void
  closeAuth: () => void
  open: boolean
}

export const AuthDialogContext = createContext<AuthDialogContextValue | null>(null)

export function useAuthDialog(): AuthDialogContextValue {
  const context = useContext(AuthDialogContext)
  if (!context) throw new Error('useAuthDialog must be used within AuthDialogProvider.')
  return context
}
