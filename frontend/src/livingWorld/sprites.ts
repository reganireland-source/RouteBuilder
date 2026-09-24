/**
 * livingWorld/sprites.ts — the 16-bit bestiary.
 *
 * Every sprite is hand-drawn as rows of characters, one character per pixel,
 * with a per-sprite palette mapping those characters to colours. `.` is
 * transparent. Rows do NOT have to be the same length: `spriteSvg` pads them to
 * the widest, which means a sprite can be edited without counting dots.
 *
 * Why strings rather than PNGs: the whole bestiary is a few kilobytes of source
 * you can read and edit in place, there is no asset pipeline, no network
 * request, and no image that renders at the wrong size on a retina screen. The
 * SVG is emitted with `shape-rendering="crispEdges"` so the pixels stay pixels
 * instead of being smoothed into mush.
 *
 * Colours are deliberately LITERAL here rather than theme tokens. These are
 * pictures of things — a container ship's hull is red, a whale is not — and
 * recolouring a whale per theme would make it a blob. What does adapt is the
 * layer's overall opacity (see LivingWorldLayer), which is what keeps them
 * subtle on a light basemap as well as a dark one.
 *
 * Every sprite faces RIGHT. The layer mirrors it with scaleX(-1) when the
 * thing is drifting left, so nothing ever swims backwards.
 */

/** Where a sprite is allowed to appear. */
export type Habitat = 'open' | 'polar'

export interface Sprite {
  id: string
  /** Shown in the sighting log; also the marker's accessible label. */
  label: string
  rows: string[]
  palette: Record<string, string>
  /** On-screen size of one sprite pixel, before the layer's own scaling. */
  scale: number
  /**
   * Relative likelihood. A cargo ship at 30 turns up many times as often as a
   * kraken at 2 — the rare ones have to stay rare or they stop being a
   * surprise, which is the entire point of the feature.
   */
  weight: number
  habitat: Habitat
  /** px/second it drifts. Ships are faster than icebergs; krakens do not move. */
  speed: number
}

// ── The bestiary ──────────────────────────────────────────────────────────

const WHALE: Sprite = {
  id: 'whale',
  label: 'Humpback whale',
  scale: 2, weight: 18, habitat: 'open', speed: 5,
  rows: [
    '.......s...s....',
    '........s.s.....',
    '.........s......',
    '.........s......',
    '.tt....bbbbbb...',
    'ttttbbbbbbbbbbb.',
    '.tttbbbbbbbbbbe.',
    '..ttbbbbbbbbbbb.',
    '....llllllllll..',
    '.....llllll.....',
  ],
  palette: { s: '#cfe6ff', t: '#1f3d66', b: '#35618f', l: '#8fb8dd', e: '#ffffff' },
}

const SHARK: Sprite = {
  id: 'shark',
  // The oldest joke in subsea: sharks bite cables. They really do — it is why
  // some segments carry extra armouring. Putting one on a subsea cable map is
  // the single most on-the-nose sprite in here, and it stays.
  label: 'Shark (eyeing the armouring)',
  scale: 2, weight: 10, habitat: 'open', speed: 7,
  rows: [
    '......f.........',
    '.....fff........',
    '.tt.ffffff......',
    'tttt.ggggggggg..',
    '.ttgggggggggge..',
    '..gggggggggggg..',
    '...llllllllwww..',
    '.....ll.........',
  ],
  palette: { f: '#5b6b7a', t: '#44525e', g: '#6e7f8f', l: '#c8d4dd', w: '#ffffff', e: '#101418' },
}

const DOLPHIN: Sprite = {
  id: 'dolphin',
  label: 'Dolphin, mid-leap',
  scale: 2, weight: 14, habitat: 'open', speed: 9,
  rows: [
    '..........ddd...',
    '.........dddddd.',
    '........ddddddE.',
    '..tt...ddddddd..',
    '.tttt.ddddddd...',
    '..tttddddddd....',
    '....llllllll....',
  ],
  palette: { d: '#5f7f9e', t: '#3f5a73', l: '#cfdce6', E: '#101418' },
}

const CARGO_SHIP: Sprite = {
  id: 'cargo',
  label: 'Container ship',
  scale: 2, weight: 30, habitat: 'open', speed: 8,
  rows: [
    '..............F.',
    '..rr.yy.bb....F.',
    '..rr.yy.bb...cc.',
    '.byy.rr.yb...cc.',
    'hhhhhhhhhhhhhhhh',
    '.HHHHHHHHHHHHHH.',
    '..wwwwwwwwww....',
  ],
  palette: {
    r: '#c0453a', y: '#d8a63c', b: '#3f72ad', F: '#e8e4dc',
    c: '#e8e4dc', h: '#a8382f', H: '#2c2a2e', w: '#cfe4f2',
  },
}

const PIRATE_SHIP: Sprite = {
  id: 'pirate',
  label: 'Pirate ship',
  scale: 2, weight: 7, habitat: 'open', speed: 6,
  rows: [
    '.....m..........',
    '.....mkkk.......',
    '.....mkKk.......',
    '.....m..........',
    '...yyyyyyy......',
    '...SSSSSSSS.....',
    '....SSSSSSS.....',
    '.....SSSSS......',
    '.....m.........b',
    '.hhhhhhhhhhhhbb.',
    '..HHHHHHHHHHH...',
    '...wwwwwwwww....',
  ],
  palette: { m: '#6b4a2a', y: '#5a3d22', b: '#6b4a2a', k: '#2a2b31', K: '#f0ece2', S: '#e4dcc6', h: '#8a5a32', H: '#4a3020', w: '#cfe4f2' },
}

const CABLE_SHIP: Sprite = {
  id: 'cableship',
  // The one sprite that is actually this product's subject matter: a cable-lay
  // vessel paying cable off the stern.
  label: 'Cable-lay vessel',
  scale: 2, weight: 9, habitat: 'open', speed: 5,
  rows: [
    '...DDD...F......',
    '..DdddD..F..cc..',
    '...DDD......cc..',
    '.hhhhhhhhhhhhh..',
    '..HHHHHHHHHHH...',
    '.CC.wwwwwwwww...',
    'CC..............',
  ],
  palette: { D: '#d8a63c', d: '#8a6a20', F: '#e8e4dc', c: '#e8e4dc', h: '#2f6f8f', H: '#1d3f52', C: '#c8d0d8', w: '#cfe4f2' },
}

const SUBMARINE: Sprite = {
  id: 'submarine',
  label: 'Submarine',
  scale: 2, weight: 6, habitat: 'open', speed: 6,
  rows: [
    '.......p........',
    '.......p........',
    '......ttt.......',
    'x.ssssssssssss..',
    'xxsssssssssssss.',
    'x.ssssssssssss..',
    '...bbbbbbbbbb...',
  ],
  palette: { p: '#9aa4ad', t: '#3c4750', s: '#4e5a64', b: '#2b333a', x: '#6d7780' },
}

const SAILBOAT: Sprite = {
  id: 'sailboat',
  label: 'Sailing yacht',
  scale: 2, weight: 16, habitat: 'open', speed: 7,
  rows: [
    '....m....',
    '....mS...',
    '....mSS..',
    '....mSSS.',
    '..hhhhhhh',
    '...HHHHH.',
    '....www..',
  ],
  palette: { m: '#8a8f96', S: '#f2efe6', h: '#c9553f', H: '#3a3f46', w: '#cfe4f2' },
}

const SEA_SERPENT: Sprite = {
  id: 'serpent',
  label: 'Sea serpent — here be dragons',
  scale: 2, weight: 3, habitat: 'open', speed: 4,
  rows: [
    '.............HHH',
    '............HHeH',
    '............HH..',
    '..GGG..GGG..GG..',
    '.GGGGGGGGGGGGG..',
    '~~~~~~~~~~~~~~~~',
  ],
  palette: { G: '#4e8f5a', H: '#3f7a4a', e: '#f2e04a', '~': '#9fc4e8' },
}

const KRAKEN: Sprite = {
  id: 'kraken',
  label: 'Kraken',
  scale: 2, weight: 2, habitat: 'open', speed: 0,
  rows: [
    't.....t.........',
    'tt....tt....t...',
    '.t.....t...tt...',
    '.tt....tt..t....',
    '..tt....t..tt...',
    '..tt...tt...t...',
    '.tts...ts..tts..',
    'tttttttttttttt..',
    '~~~~~~~~~~~~~~~~',
  ],
  palette: { t: '#7a4a86', s: '#c79ad0', '~': '#9fc4e8' },
}

const ICEBERG: Sprite = {
  id: 'iceberg',
  label: 'Iceberg',
  scale: 2, weight: 20, habitat: 'polar', speed: 2,
  rows: [
    '......ii........',
    '.....iiii.......',
    '....iiiiii..ii..',
    '..iiiiiiiiiiiii.',
    '~~~~~~~~~~~~~~~~',
    '..cccccccccccc..',
    '...cccccccccc...',
    '....cccccc......',
  ],
  palette: { i: '#eaf4ff', c: '#7fa8c9', '~': '#9fc4e8' },
}

const UFO: Sprite = {
  id: 'ufo',
  // Deliberately the rarest thing in here. If you see one, you have been
  // staring at the Pacific for a very long time.
  label: 'Unidentified',
  scale: 2, weight: 1, habitat: 'open', speed: 14,
  rows: [
    '.....gggggg.....',
    '....gggggggg....',
    '..UUUUUUUUUUUU..',
    '.UUUUUUUUUUUUUU.',
    '..l..l..l..l....',
    '....bbbbbbbb....',
    '.....bbbbbb.....',
  ],
  palette: { g: '#a8e6f2', U: '#c3cbd4', l: '#f2e04a', b: '#7fe6c0' },
}

/** The full bestiary, in no particular order (see pickSprite for how one is
 *  chosen — order here has no effect on odds, only each entry's `weight` does). */
export const SPRITES: Sprite[] = [
  CARGO_SHIP, WHALE, SAILBOAT, DOLPHIN, SHARK,
  CABLE_SHIP, PIRATE_SHIP, SUBMARINE,
  SEA_SERPENT, KRAKEN, UFO,
  ICEBERG,
]

// ── Picking one ───────────────────────────────────────────────────────────

/**
 * Weighted random pick from the sprites allowed in `habitat`. `rand` is
 * injected so the whole thing can be exercised deterministically rather than
 * by staring at the ocean hoping for a kraken.
 */
export function pickSprite(habitat: Habitat, rand: () => number = Math.random): Sprite {
  const pool = SPRITES.filter(s => s.habitat === habitat)
  const total = pool.reduce((sum, s) => sum + s.weight, 0)
  let roll = rand() * total
  for (const s of pool) {
    roll -= s.weight
    if (roll <= 0) return s
  }
  // Only reachable through floating-point slop at the very top of the range.
  return pool[pool.length - 1]
}

// ── Drawing ───────────────────────────────────────────────────────────────

/** Width in sprite pixels — the longest row, since rows may be ragged. */
export function spriteWidth(sprite: Sprite): number {
  return Math.max(...sprite.rows.map(r => r.length))
}

export function spriteHeight(sprite: Sprite): number {
  return sprite.rows.length
}

/**
 * One <rect> per horizontal RUN of same-coloured pixels rather than per pixel.
 * A container ship's hull is one rect instead of sixteen, which roughly halves
 * the markup for no loss of fidelity.
 */
function rowRects(row: string, y: number, palette: Record<string, string>): string {
  const out: string[] = []
  let x = 0
  while (x < row.length) {
    const ch = row[x]
    let run = 1
    while (x + run < row.length && row[x + run] === ch) run++
    const fill = palette[ch]
    if (fill) out.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`)
    x += run
  }
  return out.join('')
}

/** The sprite as an SVG string, sized in sprite pixels and scaled by CSS. */
export function spriteSvg(sprite: Sprite, pxSize: number): string {
  const w = spriteWidth(sprite)
  const h = spriteHeight(sprite)
  const body = sprite.rows.map((row, y) => rowRects(row, y, sprite.palette)).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" `
    + `width="${w * pxSize}" height="${h * pxSize}" shape-rendering="crispEdges" `
    + `style="display:block;image-rendering:pixelated">${body}</svg>`
  )
}
