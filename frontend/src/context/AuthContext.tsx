import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setAdminToken as setClientToken, clearAdminToken as clearClientToken } from '../api/client'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

interface AuthCtx {
  isAdmin: boolean
  authRequired: boolean
  unlock: (key: string) => Promise<boolean>
  lock: () => void
}

const AuthContext = createContext<AuthCtx>({
  isAdmin: true,
  authRequired: false,
  unlock: async () => false,
  lock: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authRequired, setAuthRequired] = useState(false)
  const [adminToken, setAdminToken] = useState<string>(() => {
    const stored = sessionStorage.getItem('rb_admin_token') ?? ''
    if (stored) setClientToken(stored)
    return stored
  })

  useEffect(() => {
    fetch(`${BASE_URL}/api/auth/status`)
      .then(r => r.json())
      .then(d => setAuthRequired(Boolean(d.auth_required)))
      .catch(() => {})
  }, [])

  const unlock = async (key: string): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': key },
        body: '{}',
      })
      if (res.ok) {
        setAdminToken(key)
        setClientToken(key)
        sessionStorage.setItem('rb_admin_token', key)
        return true
      }
    } catch { /* network error */ }
    return false
  }

  const lock = () => {
    setAdminToken('')
    clearClientToken()
    sessionStorage.removeItem('rb_admin_token')
  }

  // When ADMIN_KEY is not set on the backend, everyone is admin (open/dev mode)
  const isAdmin = !authRequired || Boolean(adminToken)

  return (
    <AuthContext.Provider value={{ isAdmin, authRequired, unlock, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
