/**
 * main.tsx — application entry point (loaded by index.html via Vite).
 *
 * Mounts the React tree into the #root element under StrictMode. The tree is wrapped in
 * AuthProvider (session/auth context) and PasswordGate, which blocks rendering of the
 * main App until the user has entered the shared access password. App itself contains
 * the entire RouteBuilder UI (map, route search sidebar, admin modals, etc.).
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PasswordGate } from './components/PasswordGate'
import { AuthProvider } from './context/AuthContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <PasswordGate>
        <App />
      </PasswordGate>
    </AuthProvider>
  </React.StrictMode>
)
