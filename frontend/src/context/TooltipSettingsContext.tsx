/**
 * ============================================================================
 * context/TooltipSettingsContext.tsx — the app-wide "are hover tooltips on?" switch.
 * ============================================================================
 *
 * A single boolean, read by every <Tooltip> instance (components/Tooltip.tsx)
 * and written by one toggle row in the Controls menu (App.tsx / MobileLayout's
 * MobileControlsDrawer). A context rather than a prop because Tooltip is used
 * from dozens of call sites with no shared parent closer than App.tsx, and
 * none of those call sites should have to thread an unrelated prop through
 * just to reach it.
 *
 * Defaults to enabled and persists to localStorage, matching every other
 * sticky UI preference in this app (e.g. AssetFilterBar's own selection).
 *
 * Mounted once in main.tsx as <TooltipSettingsProvider> wrapping the whole app.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'rb.tooltipsEnabled'

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

interface TooltipSettingsCtx {
  tooltipsEnabled: boolean
  setTooltipsEnabled: (enabled: boolean) => void
}

const TooltipSettingsContext = createContext<TooltipSettingsCtx>({
  tooltipsEnabled: true,
  setTooltipsEnabled: () => {},
})

export function TooltipSettingsProvider({ children }: { children: ReactNode }) {
  const [tooltipsEnabled, setTooltipsEnabled] = useState(loadEnabled)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(tooltipsEnabled)) } catch { /* private mode */ }
  }, [tooltipsEnabled])

  return (
    <TooltipSettingsContext.Provider value={{ tooltipsEnabled, setTooltipsEnabled }}>
      {children}
    </TooltipSettingsContext.Provider>
  )
}

export const useTooltipSettings = () => useContext(TooltipSettingsContext)
