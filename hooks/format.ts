/** Pure helpers: relative times, clock times, the colour of an age. */

export const MIN = 60_000
export const H = 60 * MIN
export const D = 24 * H

/** How long a commit or push stays highlighted after it was noticed. */
export const FLASH_MS = 4000
/** Below this many columns the line switches to its compact form by itself. */
export const COMPACT_BELOW = 80
/** How often the repository is read again while nothing else asks. */
export const POLL_MS = 15_000

export const GREEN = '#3fb950'
export const YELLOW = '#d29922'
export const RED = '#f85149'
export const BLUE = '#79c0ff'
export const MUTED = '#8b949e'

/** `now`, `12m`, `3h`, `2d`, `5w`, `4mo`, `1y`: the short form used in the line. */
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 14) return `${d}d`
  if (d < 60) return `${Math.floor(d / 7)}w`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

/** `12m ago`, `just now`. */
export const ago = (ms: number): string => {
  const a = age(ms)
  return a === 'now' ? 'just now' : `${a} ago`
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `14:02` today, `Oct 5 14:02` this year, `Oct 5 2025` before. */
export function clockTime(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === n.toDateString()) return hm
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === n.getFullYear() ? `${day} ${hm}` : `${day} ${d.getFullYear()}`
}

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hex(a), hex(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')
}

/**
 * The colour of pending work by how long it has waited: green when fresh,
 * yellow halfway to `staleMs`, red from `staleMs` on.
 */
export function tone(ageMs: number, staleMs: number): string {
  const t = staleMs > 0 ? Math.min(1, Math.max(0, ageMs / staleMs)) : 0
  return t < 0.5 ? mix(GREEN, YELLOW, t * 2) : mix(YELLOW, RED, (t - 0.5) * 2)
}

/** `1 file` / `3 files`. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** `/Users/me/src/shop` → `~/src/shop` where a home folder is recognisable, else the path. */
export function shortPath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/, '~')
}
