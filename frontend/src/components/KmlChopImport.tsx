/**
 * KmlChopImport — the Chop Import panels, replacing the old scored review
 * table (KmlBulkImport) entirely.
 *
 * WHY. Measured against a real branching cable (AJC, Australia-Japan Cable,
 * Y-shaped at Guam), the automatic pipeline — join by placemark, split only
 * where an existing segment graph proves a cut point — could not represent
 * it: the joined trunk never came within 30km of the Guam node, so no split
 * was ever found, and the whole thing landed as one 30%-confidence guess
 * against the wrong segment. The reviewer usually already knows the right
 * answer even when the geometry math cannot resolve it alone, so this tool
 * hands that judgement back: plot an import on the map first (see
 * useKmlChopState.ts for why declaring a system is a refinement, not a
 * gate), then click to place, move or remove cuts on the map (KmlChopMapLayer,
 * mounted separately inside Map.tsx) and assign each resulting stretch here
 * — a declared segment, a brand-new one created inline, or left unassigned.
 *
 * TWO PANELS, ONE STATE. All the state and logic lives in useKmlChopState
 * (hooks/useKmlChopState.ts), called ONCE from App.tsx and threaded into
 * both `KmlChopSourcePanel` (the left column — source, and system/segment
 * declaration once flattened) and `KmlChopTablePanel` (the middle column —
 * the stretch table and Commit), the same lifted-state pattern App.tsx
 * already uses for Network Editor's `editorState` across `NetworkEditor` and
 * `EditorPendingPanel`. Split into a separate hook file specifically so that
 * state can be called unconditionally at the App level (React's rules of
 * hooks) while this file — the heavier presentational half, importing
 * NewSegmentForm and rendering the table — stays lazy-loaded.
 */
import { useMemo, useRef, useState } from 'react'
import type { CableNode, CableSegment, CableSystem, KmlChain, SegmentCapacity } from '../types'
import { useTheme, type Theme } from '../theme'
import { Typeahead } from './formFields'
import { NewSegmentForm } from './NewSegmentForm'
import type { KmlChopState } from '../hooks/useKmlChopState'
import {
  NEW_SEGMENT, colorForStretch, dedupeById, nearestNode, stretchKey, stretchLengthKm, stretchesFor,
} from '../hooks/useKmlChopState'

const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 11, verticalAlign: 'top' }

/** A small colour swatch matching the stretch's map colour, so a table row
 *  can be matched to its line on the map at a glance. */
function Swatch({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
}

/** The inline "no segment covers this stretch" flow: snap both ends to the
 *  nearest existing node (overridable), then host NewSegmentForm once both
 *  resolve to a real node. */
function NewSegmentInline({
  chain, start, end, nodes, segments, systems, onCreated, onCancel, busy, t,
}: {
  chain: KmlChain; start: number; end: number
  nodes: CableNode[]; segments: CableSegment[]; systems: CableSystem[]
  onCreated: (segment: CableSegment, capacity: SegmentCapacity) => void
  onCancel: () => void
  busy: boolean; t: Theme
}) {
  const aRaw = chain.coords[start]
  const zRaw = chain.coords[end]
  const aGuess = useMemo(() => nearestNode(aRaw[0], aRaw[1], nodes), [aRaw, nodes])
  const zGuess = useMemo(() => nearestNode(zRaw[0], zRaw[1], nodes), [zRaw, nodes])
  const [aQuery, setAQuery] = useState(aGuess ? `${aGuess.node.id} — ${aGuess.node.name}` : '')
  const [zQuery, setZQuery] = useState(zGuess ? `${zGuess.node.id} — ${zGuess.node.name}` : '')
  const [aId, setAId] = useState<string | null>(aGuess?.node.id ?? null)
  const [zId, setZId] = useState<string | null>(zGuess?.node.id ?? null)

  const nodeOptions = useMemo(() => nodes.map(n => ({ id: n.id, label: `${n.id} — ${n.name}` })), [nodes])
  const aNode = aId ? nodes.find(n => n.id === aId) : undefined
  const zNode = zId ? nodes.find(n => n.id === zId) : undefined

  return (
    <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${t.orange}55`, background: t.orange + '0d', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: t.textMuted }}>
        No existing segment covers this stretch. Confirm which node each end belongs to — the
        nearest one is pre-filled, with its distance from the actual on-file endpoint.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2 }}>
            Start {aGuess && <span>({aGuess.distKm.toFixed(0)} km from nearest)</span>}
          </div>
          <Typeahead
            value={aQuery} invalid={!aNode} options={nodeOptions}
            onChangeText={txt => { setAQuery(txt); setAId(null) }}
            onPick={o => { setAQuery(o.label); setAId(o.id) }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2 }}>
            End {zGuess && <span>({zGuess.distKm.toFixed(0)} km from nearest)</span>}
          </div>
          <Typeahead
            value={zQuery} invalid={!zNode} options={nodeOptions}
            onChangeText={txt => { setZQuery(txt); setZId(null) }}
            onPick={o => { setZQuery(o.label); setZId(o.id) }}
          />
        </div>
      </div>

      {aNode && zNode ? (
        <NewSegmentForm
          startNode={aNode} endNode={zNode} systems={systems} segments={segments}
          suggestedLengthKm={stretchLengthKm(chain, start, end)}
          onCancel={onCancel}
          onCreate={onCreated}
        />
      ) : (
        <button
          onClick={onCancel} disabled={busy}
          style={{ padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', alignSelf: 'flex-start' }}
        >Cancel</button>
      )}
    </div>
  )
}

/** One assigned segment's removable chip. Orange border/text when this
 *  segment is ALSO claimed by some OTHER stretch — not an error (a real gap
 *  or an unmodelled branch legitimately splits one segment's route across
 *  several stretches, joined nose-to-tail server-side on commit), just
 *  worth a glance before committing since it is the less common case.
 *  Two entries for the SAME stretch (the Y-branch case) gets no warning
 *  at all — that one really is the ordinary shape of the feature. */
function AssignmentChip({ label, multiStretch, onRemove, t }: { label: string; multiStretch: boolean; onRemove: () => void; t: Theme }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 8px',
      borderRadius: 999, fontSize: 10, fontFamily: 'inherit',
      border: `1px solid ${multiStretch ? t.orange : t.border}`,
      background: multiStretch ? t.orange + '18' : t.bgDeep,
      color: multiStretch ? t.orange : t.text,
    }}>
      {label}
      <button
        onClick={onRemove} title="Remove this assignment"
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12, lineHeight: 1 }}
      >×</button>
    </span>
  )
}

/** One stretch's row: which chain, how big, and its assignment chips — or,
 *  when the user picked "new segment", the inline creation flow instead.
 *  A stretch usually carries 0 or 1 assigned segment, but the "add a
 *  segment" control stays available even with one already assigned: the
 *  rare unmodelled-branch case (see Assignments' doc comment in
 *  useKmlChopState.ts) needs the SAME stretch attached to a second segment
 *  too, not a replacement. */
function StretchRow({
  chain, start, end, color, assignedIds, options, multiStretch, creating,
  onAdd, onRemove, onStartNew, onRemoveCut, nodes, segments, systems, onCreated, onCancelNew, busy, t,
}: {
  chain: KmlChain; start: number; end: number; color: string
  assignedIds: string[]; options: { id: string; label: string }[]; multiStretch: Set<string>; creating: boolean
  onAdd: (segmentId: string) => void
  onRemove: (segmentId: string) => void
  onStartNew: () => void
  onRemoveCut: (() => void) | null
  nodes: CableNode[]; segments: CableSegment[]; systems: CableSystem[]
  onCreated: (segment: CableSegment, capacity: SegmentCapacity) => void
  onCancelNew: () => void
  busy: boolean; t: Theme
}) {
  const pts = end - start + 1
  const km = stretchLengthKm(chain, start, end).toFixed(0)
  const labelFor = (id: string) => options.find(o => o.id === id)?.label ?? id
  const addOptions = options.filter(o => !assignedIds.includes(o.id))
  return (
    <tr style={{ borderBottom: `1px solid ${t.border}` }}>
      <td style={cell}><Swatch color={color} /></td>
      <td style={cell}>{chain.index}</td>
      <td style={cell}>
        <div style={{ color: t.text }}>{pts.toLocaleString()} pts · {km} km</div>
        <div style={{ color: t.textFaint, fontSize: 10 }}>
          {chain.coords[start][0].toFixed(2)}, {chain.coords[start][1].toFixed(2)} → {chain.coords[end][0].toFixed(2)}, {chain.coords[end][1].toFixed(2)}
        </div>
      </td>
      <td style={cell}>
        {creating ? (
          <NewSegmentInline
            chain={chain} start={start} end={end} nodes={nodes} segments={segments} systems={systems}
            onCreated={onCreated} onCancel={onCancelNew} busy={busy} t={t}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {assignedIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {assignedIds.map(id => (
                  <AssignmentChip key={id} label={labelFor(id)} multiStretch={multiStretch.has(id)} onRemove={() => onRemove(id)} t={t} />
                ))}
              </div>
            )}
            <select
              value=""
              onChange={e => (e.target.value === NEW_SEGMENT ? onStartNew() : onAdd(e.target.value))}
              style={{
                width: '100%', padding: '4px 6px', fontSize: 11, fontFamily: 'inherit',
                background: t.bgDeep, color: t.text, border: `1px solid ${t.border}`, borderRadius: 4,
              }}
            >
              <option value="">{assignedIds.length === 0 ? '— unassigned —' : '+ add another segment…'}</option>
              {addOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              <option value={NEW_SEGMENT}>＋ New segment…</option>
            </select>
          </div>
        )}
        {assignedIds.some(id => multiStretch.has(id)) && !creating && (
          <div style={{ fontSize: 10, color: t.orange, marginTop: 2 }}>
            this segment also comes from another stretch — they'll be joined nose-to-tail on commit
          </div>
        )}
      </td>
      <td style={cell}>
        {onRemoveCut && (
          <button
            onClick={onRemoveCut}
            title="Remove the cut before this stretch, merging it into the previous one"
            style={{ padding: '3px 7px', borderRadius: 4, fontSize: 10, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer' }}
          >⌫ merge up</button>
        )}
      </td>
    </tr>
  )
}

/** The upload button + hidden file input, kept as its own tiny component
 *  with its OWN local ref rather than a ref threaded through the shared
 *  KmlChopState object — putting a RefObject inside that big, everywhere-
 *  destructured state object made the `react-hooks/refs` lint rule treat
 *  every later read of any of its other (non-ref) fields as "accessing a
 *  ref during render" too, since its taint analysis can't separate one
 *  field of a plain object literal from the rest. A ref that never leaves
 *  the component that owns it can't cause that. */
function FileChooserButton({ busy, pendingFiles, onChoose, t }: {
  busy: boolean; pendingFiles: File[]; onChoose: (files: File[]) => void; t: Theme
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input
        ref={fileRef} type="file" multiple
        accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml"
        style={{ display: 'none' }}
        onChange={e => { onChoose([...(e.target.files ?? [])]); e.target.value = '' }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{
          padding: '7px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          border: `1px solid ${t.blue}`, background: t.blue + '18', color: t.blue,
          cursor: busy ? 'default' : 'pointer',
        }}
      >⬆ Choose KMZ / KML files</button>
      {pendingFiles.length > 0 && (
        <span style={{ marginLeft: 8, fontSize: 11, color: t.textMuted }}>{pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} chosen</span>
      )}
    </div>
  )
}

/** The left-column panel: source, then (once flattened) system/segment
 *  declaration — always editable, never a gate on seeing the plotted import. */
export function KmlChopSourcePanel({ state, onClose }: { state: KmlChopState; onClose: () => void }) {
  const t = useTheme()
  const s = state
  const scmOptions = useMemo(() => s.scmCables.map(c => ({ id: c.id, label: c.name })), [s.scmCables])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Chop Import</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            {s.flat ? 'Declare a system to get suggested cuts, or just click the map.' : 'Choose a source, then plot it on the map.'}
          </div>
        </div>
        <button onClick={onClose} title="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textFaint, fontSize: 18, lineHeight: 1 }}
        >×</button>
      </div>

      {s.error && <div style={{ fontSize: 11, color: t.red }}>{s.error}</div>}

      {!s.flat && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['upload', 'sync'] as const).map(m => (
              <button
                key={m}
                onClick={() => s.setSourceMode(m)}
                disabled={s.busy}
                style={{
                  padding: '5px 11px', borderRadius: 5, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                  border: `1px solid ${s.sourceMode === m ? t.blue : t.border}`,
                  background: s.sourceMode === m ? t.blue + '18' : 'transparent',
                  color: s.sourceMode === m ? t.blue : t.textMuted,
                  cursor: s.busy ? 'default' : 'pointer',
                }}
              >{m === 'upload' ? '⬆ Upload files' : '🔄 Sync from Submarine Cable Map'}</button>
            ))}
          </div>

          {s.sourceMode === 'upload' ? (
            <div key="upload-source">
              <FileChooserButton busy={s.busy} pendingFiles={s.pendingFiles} onChoose={s.setPendingFiles} t={t} />
            </div>
          ) : (
            <div key="sync-source">
              <Typeahead
                value={s.scmQuery}
                onChangeText={txt => { s.setScmQuery(txt); s.setScmSelectedId(null) }}
                onPick={o => { s.setScmQuery(o.label); s.setScmSelectedId(o.id) }}
                options={scmOptions}
                placeholder={s.scmCables.length === 0 ? 'Loading cable list…' : 'Search submarine cable name…'}
                disabled={s.busy || s.scmCables.length === 0}
                emptyText="No cables match."
              />
            </div>
          )}

          <button
            onClick={s.runFlatten}
            disabled={s.busy || !s.canFlatten}
            style={{
              padding: '9px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              border: `1px solid ${s.canFlatten ? t.green : t.border}`,
              background: s.canFlatten ? t.green + '20' : 'transparent',
              color: s.canFlatten ? t.green : t.textFaint,
              cursor: s.busy || !s.canFlatten ? 'default' : 'pointer',
            }}
          >{s.busy ? 'Fetching…' : '🔀 Flatten & plot'}</button>
        </>
      )}

      {s.flat && (
        <>
          {s.flat.rejected.length > 0 && (
            <div style={{ fontSize: 11, color: t.orange }}>
              {s.flat.rejected.map(r => <div key={r.filename}>{r.filename}: {r.reason}</div>)}
            </div>
          )}

          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 4 }}>
              System
            </div>
            <select
              value={s.systemId}
              onChange={e => s.chooseSystem(e.target.value)}
              disabled={s.busy}
              style={{
                width: '100%', padding: '6px 8px', fontSize: 12, fontFamily: 'inherit',
                background: t.bgDeep, color: t.text, border: `1px solid ${t.border}`, borderRadius: 5,
              }}
            >
              <option value="">— which system does this cover? —</option>
              {[...s.systems].sort((a, b) => a.id.localeCompare(b.id)).map(sys => (
                <option key={sys.id} value={sys.id}>{sys.id} — {sys.name}</option>
              ))}
            </select>
          </div>

          {s.systemId && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 4 }}>
                Segments this import covers
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto', border: `1px solid ${t.border}`, borderRadius: 5, padding: 6 }}>
                {s.systemSegments.length === 0 && (
                  <span style={{ fontSize: 11, color: t.textFaint }}>{s.systemId} has no segments yet.</span>
                )}
                {s.systemSegments.map(seg => (
                  <label key={seg.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: t.text, cursor: 'pointer' }}>
                    <input type="checkbox" checked={s.declaredIds.has(seg.id)} onChange={() => s.toggleDeclared(seg.id)} />
                    {seg.id} <span style={{ color: t.textFaint }}>— {seg.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={s.startOver}
            disabled={s.busy}
            style={{ padding: '6px 11px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', border: `1px solid ${t.border}`, background: 'transparent', color: t.textMuted, cursor: 'pointer', alignSelf: 'flex-start' }}
          >← Start over</button>
        </>
      )}
    </div>
  )
}

/** The middle-column panel: the stretch table, Commit, and the result. */
export function KmlChopTablePanel({ state }: { state: KmlChopState }) {
  const t = useTheme()
  const s = state

  if (!s.flat) {
    return <p style={{ color: t.textFaintest, fontSize: 13, marginTop: 8 }}>Choose a source on the left and flatten it to begin.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...cell, width: 18 }} />
            <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left', width: 40 }}>Chain</th>
            <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left' }}>Stretch</th>
            <th style={{ ...cell, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: t.textMuted, textAlign: 'left' }}>Assign to</th>
            <th style={{ ...cell, width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {s.flat.chains.flatMap(chain =>
            stretchesFor(chain, s.cutsByChain[chain.index] ?? []).map((stretch, i) => {
              const key = stretchKey(chain.index, stretch.start)
              const assignedIds = s.assignments[key] ?? []
              const options = dedupeById([...s.systemSegments, ...s.sessionSegments.filter(x => x.system_id === s.systemId)])
                .map(x => ({ id: x.id, label: `${x.id} — ${x.name}` }))
              return (
                <StretchRow
                  key={key}
                  chain={chain} start={stretch.start} end={stretch.end}
                  color={colorForStretch(chain.index, stretch.start)}
                  assignedIds={assignedIds} options={options} multiStretch={s.multiStretch}
                  creating={s.creatingKey === key}
                  onAdd={id => s.addAssignment(chain.index, stretch.start, id)}
                  onRemove={id => s.removeAssignment(chain.index, stretch.start, id)}
                  onStartNew={() => s.setCreatingKey(key)}
                  onRemoveCut={i > 0 ? () => s.removeCut(chain.index, stretch.start) : null}
                  nodes={s.nodes} segments={s.allSegments} systems={s.systems}
                  onCreated={(seg, cap) => s.createSegmentFor(chain.index, stretch.start, seg, cap)}
                  onCancelNew={() => s.setCreatingKey(null)}
                  busy={s.busy} t={t}
                />
              )
            }),
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {s.multiStretch.size > 0 && (
          <span style={{ fontSize: 11, color: t.orange }}>
            {s.multiStretch.size} segment{s.multiStretch.size === 1 ? '' : 's'} built from multiple stretches — will be joined nose-to-tail
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={s.commit}
          disabled={s.busy || s.assignedCount === 0}
          style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            border: `1px solid ${s.assignedCount ? t.green : t.border}`,
            background: s.assignedCount ? t.green + '20' : 'transparent',
            color: s.assignedCount ? t.green : t.textFaint,
            cursor: s.busy || !s.assignedCount ? 'default' : 'pointer',
          }}
        >Commit {s.assignedCount} route{s.assignedCount === 1 ? '' : 's'}</button>
      </div>

      {s.result && (
        <div style={{ fontSize: 11 }}>
          <span style={{ color: t.green, fontWeight: 700 }}>Attached {s.result.summary.linked} route{s.result.summary.linked === 1 ? '' : 's'}.</span>
          {s.result.failed.map((f, i) => (
            <div key={i} style={{ color: t.red }}>{f.segment_id ?? '?'}: {f.reason}</div>
          ))}
        </div>
      )}
    </div>
  )
}
