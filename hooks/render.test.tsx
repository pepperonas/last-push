import { expect, mock, test } from 'claude-code/testing'

const S = 1000
const MIN = 60 * S
const H = 60 * MIN

const HINT = {
  plugin: 'last-push',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

/** A pretend repository: what git would answer. Times are ms on the mocked clock. */
type Repo = {
  isRepo: boolean
  branch: string
  commit?: { at: number; hash: string; subject: string }
  upstream?: string
  remote: boolean
  pushes: { ref: string; at: number }[]
  unpushed: { at: number; hash: string }[]
  behind: number
  status: string[]
}

const repo = (r: Partial<Repo> = {}): Repo => ({
  isRepo: true,
  branch: 'main',
  commit: { at: 0, hash: 'a1b2c3d', subject: 'fix login' },
  upstream: 'origin/main',
  remote: true,
  pushes: [{ ref: 'refs/remotes/origin/main', at: 0 }],
  unpushed: [],
  behind: 0,
  status: [],
  ...r,
})

const sec = (ms: number) => String(Math.floor(ms / 1000))

/** git's answer to one argv, from the pretend repository. */
function answer(r: Repo, argv: readonly string[]): { exitCode: number; stdout: string } {
  const a = argv.slice(2).join(' ')
  const yes = (stdout: string) => ({ exitCode: 0, stdout })
  const no = { exitCode: 128, stdout: '' }
  if (!r.isRepo) return no
  if (a === 'rev-parse --show-toplevel') return yes('/Users/me/src/shop\n')
  if (a.startsWith('symbolic-ref')) return yes(`${r.branch}\n`)
  if (a.startsWith('log -1')) return r.commit ? yes(`${sec(r.commit.at)}\t${r.commit.hash}\t${r.commit.subject}\n`) : no
  if (a === 'rev-parse --short HEAD') return yes('a1b2c3d\n')
  if (a.includes('@{u}') && a.startsWith('rev-parse')) return r.upstream ? yes(`${r.upstream}\n`) : no
  if (a === 'remote') return yes(r.remote ? 'origin\n' : '')
  if (a.startsWith('for-each-ref')) return yes(r.upstream ? `refs/remotes/${r.upstream}\n` : '')
  if (a.startsWith('log -g')) return yes(r.pushes.map(p => `${p.ref}@{${sec(p.at)}}`).join('\n'))
  if (a.startsWith('log --format=%ct%x09%h')) return yes(r.unpushed.map(u => `${sec(u.at)}\t${u.hash}`).join('\n'))
  if (a.startsWith('rev-list --count')) return r.upstream ? yes(`${r.behind}\n`) : no
  if (a === 'status --porcelain') return yes(r.status.join('\n'))
  return no
}

/** Stand-in for the engine beneath the plugin. */
function engine(on: any, state: { repo: Repo }) {
  const clock = mock.clock(on)
  mock.store(on)
  const toasts: string[] = []
  const runs: string[][] = []
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/me/src/shop' }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    runs.push([...e.argv])
    return { value: { ...answer(state.repo, e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(String(e.text ?? e))
    return { value: undefined }
  })
  return { clock, toasts, runs }
}

const start = ($: any) => $.session.start({ cwd: '/Users/me/src/shop', surface: 'terminal', isInteractive: true })
const mount = ($: any, surface: 'terminal' | 'desktop', columns = 120): Promise<any> =>
  $.ui.mount({ ...HINT, surface, viewport: { columns, rows: 40 } })
const all = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
const cmd = ($: any, args = '') => $.command.run({ command: 'last-push', args })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the line under the prompt, engine hint kept (${surface})`, async ($, on) => {
    const st = { repo: repo() }
    const { clock } = engine(on, st)
    await clock.advance(3 * H)
    st.repo.commit!.at = 3 * H - 12 * MIN
    await start($)
    const ui = await mount($, surface)
    const t = await all(ui)
    expect(t).toContain('? for shortcuts')
    expect(t).toContain('⎇ main')
    expect(t).toContain('commit 12m ago')
    expect(t).toContain('↑ pushed 3h ago')
    expect(t).toContain('✓ in sync')
    // the hover card is in the tree
    expect(t).toContain('main → origin/main')
  })

  test(`outside a git repository: only the engine's hint (${surface})`, async ($, on) => {
    engine(on, { repo: repo({ isRepo: false }) })
    await start($)
    const ui = await mount($, surface)
    expect(await ui.find({ text: '? for shortcuts' })).toBeDefined()
    expect(await all(ui)).not.toContain('⎇')
  })
}

test('waiting work: unpushed, behind and changed files', async ($, on) => {
  const st = { repo: repo({ unpushed: [{ at: 0, hash: 'b' }, { at: 0, hash: 'c' }], behind: 1, status: [' M a.ts', '?? b.ts'] }) }
  const { clock } = engine(on, st)
  await clock.advance(H)
  await start($)
  const t = await all(await mount($, 'terminal'))
  expect(t).toContain('⇡2 unpushed')
  expect(t).toContain('⇣1 behind')
  expect(t).toContain('✎ 2 changed')
  expect(t).not.toContain('in sync')
})

test('narrow terminals get the compact form by themselves', async ($, on) => {
  const st = { repo: repo() }
  const { clock } = engine(on, st)
  await clock.advance(H)
  await start($)
  const t = await all(await mount($, 'terminal', 60))
  expect(t).toContain('↑1h')
  expect(t).not.toContain('pushed')
})

test('a commit made outside Claude Code shows up on the next poll', async ($, on) => {
  const st = { repo: repo() }
  const { clock } = engine(on, st)
  await clock.advance(2 * H)
  await start($)
  const ui = await mount($, 'terminal')
  expect(await all(ui)).toContain('commit 2h ago')
  st.repo.commit = { at: 2 * H, hash: 'fff0000', subject: 'by hand' }
  st.repo.unpushed = [{ at: 2 * H, hash: 'fff0000' }]
  await clock.advance(16 * S)
  const t = await all(ui)
  expect(t).toContain('commit ')
  expect(t).toContain('⇡1 unpushed')
})

test('a push after a tool call is noticed at once and flashes, then settles', async ($, on) => {
  const st = { repo: repo({ unpushed: [{ at: 0, hash: 'b' }] }) }
  const { clock } = engine(on, st)
  on('tool.call', () => ({ result: 'pushed' }))
  await clock.advance(H)
  await start($)
  const ui = await mount($, 'terminal')
  expect(await all(ui)).toContain('⇡1 unpushed')

  st.repo.pushes = [{ ref: 'refs/remotes/origin/main', at: H }]
  st.repo.unpushed = []
  await $.tool.call({ tool: 'Bash', command: 'git push' } as any)
  await clock.advance(500) // the refresh waits for tool calls to settle, then reads
  let t = await all(ui)
  expect(t).toContain('pushed just now')
  expect(t).toContain('✨')
  expect(t).not.toContain('unpushed')
  await clock.advance(6 * S)
  t = await all(ui)
  expect(t).not.toContain('✨')
  expect(t).toContain('✓ in sync')
})

test('stale unpushed work toasts once per state, and again for a new one', async ($, on) => {
  const st = { repo: repo({ unpushed: [{ at: 0, hash: 'old1' }] }) }
  const { clock, toasts } = engine(on, st)
  await clock.advance(5 * H)
  await start($)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('not pushed for 5h')
  await clock.advance(5 * S)
  await cmd($, 'refresh')
  expect(toasts.length).toBe(1)
  // a different oldest commit is a different state (e.g. after a rebase)
  st.repo.unpushed = [{ at: 0, hash: 'new1' }]
  await cmd($, 'refresh')
  expect(toasts.length).toBe(2)
})

test('reminders off: no toast', async ($, on) => {
  const st = { repo: repo() }
  const { clock, toasts } = engine(on, st)
  await clock.advance(5 * H)
  await start($)
  await cmd($, 'reminders off')
  st.repo.unpushed = [{ at: 0, hash: 'old1' }]
  await cmd($, 'refresh')
  expect(toasts.length).toBe(0)
  await cmd($, 'reminders on')
  await cmd($, 'refresh')
  expect(toasts.length).toBe(1)
})

test('/last-push: report, modes, stale time, and settings that survive a new session', async ($, on) => {
  const st = { repo: repo() }
  const { clock } = engine(on, st)
  await clock.advance(H)
  await start($)
  const report = await cmd($)
  expect(report.text).toContain('push       1h ago')
  expect(report.text).toContain('/last-push remind <hours>')

  const ui = await mount($, 'terminal')
  expect((await cmd($, 'off')).text).toContain('mode off')
  expect(await all(ui)).not.toContain('⎇')
  await cmd($, 'compact')
  expect(await all(ui)).toContain('↑1h')
  expect((await cmd($, 'remind 2')).text).toContain('stale after 2h')
  expect((await cmd($, 'remind x')).text).toContain('remind <hours>')

  // a new session reads what was stored
  await start($)
  expect((await cmd($, 'refresh')).text).toContain('mode compact · reminders on · stale after 2h')
})

test('userConfig sets the defaults', { options: { mode: 'compact', remindAfter: 1 } }, async ($, on) => {
  const st = { repo: repo() }
  const { clock } = engine(on, st)
  await clock.advance(H)
  await start($)
  expect((await cmd($, 'refresh')).text).toContain('mode compact · reminders on · stale after 1h')
})

test('every git call is read-only and lock-free', async ($, on) => {
  const st = { repo: repo() }
  const { runs } = engine(on, st)
  await start($)
  expect(runs.length).toBeGreaterThan(5)
  for (const r of runs) {
    expect(r[0]).toBe('git')
    expect(r[1]).toBe('--no-optional-locks')
    expect(['push', 'fetch', 'pull', 'commit', 'reset', 'checkout']).not.toContain(r[2])
  }
})
