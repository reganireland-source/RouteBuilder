/**
 * ============================================================================
 *  PickedAssetsList.tsx — everything currently highlighted via Asset Search,
 *  listed under the search box.
 * ============================================================================
 *
 * Asset Search used to be single-shot: picking a segment replaced the previous
 * spotlight, so there was no way to look at three unrelated cables at once.
 * Now each pick ADDS to a highlight set that persists on the map, and this
 * list shows that set so it can be revisited (click a row to zoom back to it),
 * pruned (×), or cleared.
 *
 * Cable systems are listed here too, but they are not stored separately: they
 * ARE App's existing `selectedSystems` highlight (distinct per-system colours,
 * capped at 5), so a system shows up here however it was highlighted, and
 * removing it here un-highlights it everywhere. Cities and countries are
 * places to go rather than things to highlight, so picking one still just
 * navigates and never appears in this list.
 *
 * Mounted from: App.tsx, directly under the desktop sidebar's AssetSearch.
 * ============================================================================
 */
import { useTheme } from '../theme'
import type { AssetHit } from '../utils/assetSearch'
import { KindChip } from './AssetSearch'

/** A highlighted asset as listed here — an AssetHit minus its search score. */
export type PickedAsset = Pick<AssetHit, 'kind' | 'id' | 'label' | 'sublabel'>

interface Props {
  items: PickedAsset[]
  onFocus: (item: PickedAsset) => void
  onRemove: (item: PickedAsset) => void
  onClear: () => void
}

export function PickedAssetsList({ items, onFocus, onRemove, onClear }: Props) {
  const t = useTheme()
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 8, border: `1px solid ${t.border}`, borderRadius: 8, background: t.bgDeep, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', borderBottom: `1px solid ${t.border}` }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
          Highlighted · {items.length}
        </span>
        <button
          onClick={onClear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', padding: 0 }}
        >Clear all</button>
      </div>
      {/* ~5 rows visible, then it scrolls, so a long pick list never pushes the sidebar's own content off-screen. */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 172, overflowY: 'auto' }}>
        {items.map(item => (
          <li key={`${item.kind}:${item.id}`} style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${t.border}55` }}>
            <button
              onClick={() => onFocus(item)}
              title="Zoom to this"
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}
            >
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                {item.sublabel && (
                  <span style={{ display: 'block', fontSize: 10, color: t.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sublabel}</span>
                )}
              </span>
              <KindChip kind={item.kind} />
            </button>
            <button
              onClick={() => onRemove(item)}
              aria-label={`Remove ${item.label}`}
              title="Remove highlight"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 16, lineHeight: 1, padding: '4px 10px 4px 2px' }}
            >×</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
