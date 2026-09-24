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

/**
 * Reads the persisted tooltip preference from localStorage.
 * @returns `true` (tooltips on) if nothing was ever stored, otherwise the
 *   stored boolean; falls back to `true` if localStorage throws (e.g.
 *   private-browsing mode blocking storage access).
 */
function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/** Shape of the context value returned by useTooltipSettings(). */
interface TooltipSettingsCtx {
  /** Whether hover tooltips should render anywhere in the app. */
  tooltipsEnabled: boolean
  /** Updates the preference and persists it to localStorage (see the
   *  effect below). */
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
