/**
 * Renders the README images from the mod's own renderer (hooks/row.ts), so
 * every picture shows exactly what the mod draws.
 *
 *   npm run screenshots   # docs/*.png, docs/demo.gif, docs/social.png, .claude-plugin/icon.png
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`) and ffmpeg
 * for the GIF.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

import type { Flash, Prefs, Snapshot } from '../types/index.d.ts'
import { detailText, reminders, rowSegs } from '../hooks/row.ts'
import type { Seg } from '../hooks/row.ts'

const ROOT = resolve(import.meta.dirname, '..')
const DOCS = join(ROOT, 'docs')
const TMP = join(DOCS, '.render')
const S = 1000
const MIN = 60 * S
const H = 60 * MIN
const NOW = new Date(2026, 9, 7, 16, 40, 0).getTime()

const PREFS: Prefs = { mode: 'full', reminders: true, remindAfter: 4 }
const BASE: Snapshot = {
  root: '/Users/me/projects/shop',
  branch: 'main',
  detached: false,
  commit: { at: NOW - 12 * MIN, hash: '4f9c2e1', subject: 'Add rate limiting to the login route' },
  upstream: 'origin/main',
  hasRemote: true,
  onRemote: true,
  push: { at: NOW - 3 * H, ref: 'refs/remotes/origin/main' },
  repoPush: { at: NOW - 3 * H, ref: 'refs/remotes/origin/main' },
  ahead: 2,
  oldestUnpushed: { at: NOW - 95 * MIN, hash: 'b71d0a3' },
  behind: 0,
  changed: 3,
  untracked: 1,
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const span = (s: Seg) =>
  `<span style="${s.color ? `color:${s.color};` : ''}${s.bg ? `background:${s.bg};` : ''}${s.dim ? 'opacity:.5;' : ''}${s.bold ? 'font-weight:700;' : ''}">${esc(s.text)}</span>`
type Row = { snap?: Partial<Snapshot>; now?: number; compact?: boolean; flash?: Flash | null; prefs?: Partial<Prefs> }
const row = (r: Row = {}) =>
  rowSegs({ snap: { ...BASE, ...r.snap }, prefs: { ...PREFS, ...r.prefs }, now: r.now ?? NOW, compact: r.compact ?? false, flash: r.flash })
    .map(span)
    .join('')

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:transparent;font-family:"SF Mono",Menlo,"JetBrains Mono",monospace;font-size:15px;color:#e6edf3;padding:24px}
.term{background:#0d1117;border:1px solid #30363d;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden;display:inline-block;min-width:100%}
.bar{height:34px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;padding:0 14px;gap:8px}
.dot{width:12px;height:12px;border-radius:50%}
.title{flex:1;text-align:center;color:#8b949e;font-size:13px;margin-right:52px}
.body{padding:18px 22px;white-space:pre;line-height:1.55}
.dim{opacity:.5}.acc{color:#d2a8ff}.ok{color:#7ee787}
.box{border:1px solid #484f58;border-radius:6px;padding:4px 10px;margin:10px 0 2px}
.cap{color:#8b949e;font-size:12.5px;padding:0 0 4px 2px;font-family:-apple-system,"Segoe UI",sans-serif}
.card{background:#30363d}
.toast{display:inline-block;background:#21262d;border:1px solid #484f58;border-radius:8px;padding:6px 12px;margin-top:8px}
`

function frame(title: string, body: string) {
  return `<div class="term" id="shot"><div class="bar"><div class="dot" style="background:#ff5f57"></div><div class="dot" style="background:#febc2e"></div><div class="dot" style="background:#28c840"></div><div class="title">${esc(title)}</div></div><div class="body">${body}</div></div>`
}

function prompt(line: string, said = `Added rate limiting to <span class="ok">src/routes/login.ts</span> · all 52 tests pass`, typed = 'commit this and push') {
  return [
    `<span class="acc">⏺</span> ${said}`,
    '',
    `<div class="box"><span class="dim">&gt;</span> ${esc(typed)}<span style="background:#e6edf3"> </span></div>`,
    `<span class="dim">  ? for shortcuts</span>`,
    `  ${line}`,
  ].join('\n')
}

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(join(TMP, 'f'), { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } })

  async function shoot(name: string, html: string, out = join(DOCS, `${name}.png`), width = 1100, scale: 'device' | 'css' = 'device') {
    await page.setViewportSize({ width, height: 800 })
    const file = join(TMP, `${name.replace(/\//g, '_')}.html`)
    writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${html}</body>`)
    await page.goto(`file://${file}`)
    await page.locator('#shot').screenshot({ path: out, omitBackground: true, scale })
  }

  // Hero: the line under the prompt, mid-session.
  await shoot('hero', frame('claude — ~/projects/shop', prompt(row())))

  // The states a project goes through.
  const states: [string, string][] = [
    ['Everything committed and on the remote', row({ snap: { ahead: 0, oldestUnpushed: undefined, changed: 0, untracked: 0 } })],
    ['Fresh work: two commits not pushed yet, four files changed — still green', row({ snap: { oldestUnpushed: { at: NOW - 20 * MIN, hash: 'b' } } })],
    ['Waiting a while — the colour walks towards red', row({ snap: { oldestUnpushed: { at: NOW - 2 * H, hash: 'b' }, push: { at: NOW - 2 * H, ref: 'refs/remotes/origin/main' }, commit: { ...BASE.commit!, at: NOW - 100 * MIN } } })],
    ['Stale: older than remindAfter (4 h) — red, and a reminder', row({ snap: { oldestUnpushed: { at: NOW - 6 * H, hash: 'b' }, push: { at: NOW - 26 * H, ref: 'refs/remotes/origin/main' }, commit: { ...BASE.commit!, at: NOW - 5 * H } } })],
    ['Just pushed — it flashes', row({ snap: { ahead: 0, oldestUnpushed: undefined, changed: 0, untracked: 0, push: { at: NOW - 2 * S, ref: 'refs/remotes/origin/main' } }, flash: { kind: 'push', at: NOW - 1500 } })],
    ['Someone else pushed — you are behind (as of your last fetch)', row({ snap: { ahead: 0, oldestUnpushed: undefined, changed: 0, untracked: 0, behind: 3 } })],
    ['A new branch that was never pushed', row({ snap: { branch: 'feature/rate-limit', upstream: undefined, onRemote: false, push: undefined, changed: 0, untracked: 0, oldestUnpushed: { at: NOW - 40 * MIN, hash: 'b' } } })],
    ['A repository without a remote', row({ snap: { hasRemote: false, onRemote: false, push: undefined, repoPush: undefined, upstream: undefined, ahead: 0, oldestUnpushed: undefined } })],
    ['Detached HEAD on a commit the remote already has', row({ snap: { branch: '4f9c2e1', detached: true, upstream: undefined, push: undefined, ahead: 0, oldestUnpushed: undefined, changed: 0, untracked: 0 } })],
    ['Compact — narrow terminals or /last-push compact', row({ compact: true })],
  ]
  await shoot('states', frame('what the line tells you', states.map(([c, r]) => `<div class="cap">${esc(c)}</div>  ${r}`).join('\n')))

  // Hover card + the reminder toast.
  const stale: Partial<Snapshot> = { oldestUnpushed: { at: NOW - 6 * H, hash: 'b71d0a3' }, push: { at: NOW - 26 * H, ref: 'refs/remotes/origin/main' }, commit: { ...BASE.commit!, at: NOW - 5 * H } }
  const card = detailText({ ...BASE, repoPush: { at: NOW - 50 * MIN, ref: 'refs/remotes/origin/feature/rate-limit' } }, NOW)
  const toasts = reminders({ ...BASE, ...stale }, PREFS, NOW)
  await shoot(
    'hover',
    frame(
      'hover and reminders',
      `<div class="cap">the line</div>  ${row()}\n<div class="cap">hovered</div>  <span class="card">${esc(card)}</span>\n<div class="cap">reminders, once per state</div>${toasts.map(t => `<span class="toast">${esc(t.text)}</span>`).join('\n')}`,
    ),
  )

  // Animated demo: changed files → commit → push.
  const fps = 12
  const total = 7
  const tCommit = NOW + 2200
  const tPush = NOW + 4600
  for (let i = 0; i < fps * total; i++) {
    const now = NOW + (i / fps) * 1000
    let r: Row
    let said = 'Added rate limiting to <span class="ok">src/routes/login.ts</span> · all 52 tests pass'
    let typed = 'commit this and push'
    if (now < tCommit) r = { now, snap: { ahead: 0, oldestUnpushed: undefined, commit: { ...BASE.commit!, at: NOW - 95 * MIN } } }
    else if (now < tPush) {
      said = '<span class="dim">Bash</span> git commit -m "Add rate limiting to the login route"'
      typed = ''
      r = { now, snap: { ahead: 1, oldestUnpushed: { at: tCommit, hash: '4f9c2e1' }, commit: { ...BASE.commit!, at: tCommit }, changed: 0, untracked: 0 }, flash: { kind: 'commit', at: tCommit } }
    } else {
      said = '<span class="dim">Bash</span> git push'
      typed = ''
      r = { now, snap: { ahead: 0, oldestUnpushed: undefined, commit: { ...BASE.commit!, at: tCommit }, changed: 0, untracked: 0, push: { at: tPush, ref: 'refs/remotes/origin/main' } }, flash: { kind: 'push', at: tPush } }
    }
    await shoot(`f${String(i).padStart(3, '0')}`, frame('claude — ~/projects/shop', prompt(row(r), said, typed)), join(TMP, 'f', `f${String(i).padStart(3, '0')}.png`), 1100, 'css')
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(TMP, 'f', 'f%03d.png'), '-vf', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none', '-loop', '0', join(DOCS, 'demo.gif')])

  // Listing icon.
  const icon = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  await icon.setContent(`<body style="margin:0">${readFileSync(join(DOCS, 'icon.svg'), 'utf8')}</body>`)
  await icon.locator('svg').screenshot({ path: join(ROOT, '.claude-plugin', 'icon.png') })

  // Social preview.
  const social = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  const html = `<!doctype html><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1280px;height:640px;overflow:hidden;font-family:-apple-system,"SF Pro Display","Segoe UI",sans-serif;color:#e6edf3;
background:radial-gradient(1200px 600px at 85% -10%,#132a4a 0%,transparent 60%),radial-gradient(900px 500px at -10% 110%,#0f3326 0%,transparent 55%),#0b0e14}
.wrap{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column}
.kicker{font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:#8b949e;font-weight:600}
h1{font-size:92px;line-height:1;margin:14px 0 10px;font-weight:800;letter-spacing:-.02em}
h1 span{background:linear-gradient(90deg,#79c0ff,#3fb950 50%,#d29922);-webkit-background-clip:text;background-clip:text;color:transparent}
p{font-size:30px;color:#c9d1d9;max-width:1000px;line-height:1.3}
.term{margin-top:auto;background:#0d1117ee;border:1px solid #30363d;border-radius:14px;padding:22px 26px;font-family:"SF Mono",Menlo,monospace;font-size:21px;white-space:pre;line-height:1.7;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.foot{position:absolute;right:72px;top:70px;font-size:20px;color:#8b949e;text-align:right;line-height:1.5}
.foot b{color:#e6edf3}
</style><body><div class="wrap">
<div class="kicker">Claude Code mod</div>
<h1>last<span>-push</span></h1>
<p>When this project was last committed and pushed — and what is still waiting — in one line under the prompt.</p>
<div class="term">${row({ snap: { ahead: 0, oldestUnpushed: undefined, changed: 0, untracked: 0 } })}
${row()}
${row({ snap: stale })}</div>
</div><div class="foot"><b>github.com/pepperonas/last-push</b><br>MIT · celox.io</div></body>`
  await social.setContent(html)
  await social.screenshot({ path: join(DOCS, 'social.png') })
  await browser.close()
}

await main()
console.log('docs/: hero.png states.png hover.png demo.gif social.png · .claude-plugin/icon.png')
