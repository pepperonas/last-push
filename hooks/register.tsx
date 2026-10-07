import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { Flash, Mode, Prefs, Snapshot } from '../types'
import { COMPACT_BELOW, FLASH_MS, POLL_MS } from './format'
import { collect, sameSnap } from './git'
import type { Run } from './git'
import { detailText, reminders, reportText, rowSegs } from './row'
import type { Seg } from './row'

const snapA = atom({ plugin: 'last-push', key: 'snap' } as const, null as Snapshot | null)
const flashA = atom({ plugin: 'last-push', key: 'flash' } as const, null as Flash | null)
const prefsA = atom({ plugin: 'last-push', key: 'prefs' } as const, { mode: 'full', reminders: true, remindAfter: 4 } as Prefs)

const MODES: readonly Mode[] = ['full', 'compact', 'off']
/** How many reminder keys are remembered, so each state reminds once. */
const REMEMBER = 200
/** A tool call may have committed, pushed or edited: look again shortly after it ends. */
const AFTER_TOOL_MS = 400

/** userConfig defaults, overridden by what /last-push stored. */
export function prefsOf(options: PluginOptions, stored: unknown): Prefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Prefs>
  const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode)
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
  const isHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 720
  const opt = <T,>(v: unknown, ok: (v: unknown) => v is T, d: T): T => (ok(v) ? v : d)
  const base: Prefs = {
    mode: opt(options.mode, isMode, 'full'),
    reminders: opt(options.reminders, isBool, true),
    remindAfter: opt(options.remindAfter, isHours, 4),
  }
  return {
    mode: opt(s.mode, isMode, base.mode),
    reminders: opt(s.reminders, isBool, base.reminders),
    remindAfter: opt(s.remindAfter, isHours, base.remindAfter),
  }
}

let busy = false
let again = false
let tickTimer: Timer | undefined
let soonTimer: Timer | undefined
let ticks = 0

/** Toast what is due and was not shown for this state yet. */
async function remind($: EngineInterface, snap: Snapshot | null, now: number): Promise<void> {
  const due = reminders(snap, await read($, prefsA), now)
  if (due.length === 0) return
  const shown = (((await $.store.get('reminded').catch(() => undefined)) ?? []) as string[]).filter(k => typeof k === 'string')
  const fresh = due.filter(r => !shown.includes(r.key))
  if (fresh.length === 0) return
  for (const r of fresh) $.ui.toast(r.text, { timeoutMs: 8000 })
  await $.store.set('reminded', [...shown, ...fresh.map(r => r.key)].slice(-REMEMBER)).catch(() => undefined)
}

/** Read the repository again; redraw and highlight when something moved. */
async function refresh($: EngineInterface): Promise<void> {
  if (busy) {
    again = true
    return
  }
  busy = true
  try {
    do {
      again = false
      const cwd = await $.session.cwd().catch(() => undefined)
      const run: Run = argv => $.process.run(argv, { cwd, timeoutMs: 5000, env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
      const snap = await collect(run)
      const now = await $.clock.now()
      const old = await read($, snapA)
      if (!sameSnap(old, snap)) {
        if (old && snap && old.root === snap.root) {
          if (snap.push && snap.push.at > (old.push?.at ?? 0)) await update($, flashA, () => ({ kind: 'push', at: now }))
          else if (snap.commit && snap.commit.hash !== old.commit?.hash && snap.commit.at >= (old.commit?.at ?? 0)) {
            await update($, flashA, () => ({ kind: 'commit', at: now }))
          }
        }
        await update($, snapA, () => snap)
        $.ui.invalidate('ui.render')
      }
      await remind($, snap, now)
    } while (again)
  } finally {
    busy = false
  }
}

/** One refresh shortly from now, however many tool calls end before it. */
function soon($: EngineInterface, ms = AFTER_TOOL_MS): void {
  soonTimer?.cancel()
  soonTimer = $.clock.after(ms, () => {
    soonTimer = undefined
    void refresh($)
  })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('prefs').catch(() => undefined)
    await update($, prefsA, () => prefsOf(options, stored))
    await $.command.register({
      name: 'last-push',
      description: 'last-push: when this project was last committed and pushed (/last-push help)',
      argumentHint: '[full|compact|off|refresh|reminders on|off|remind <hours>]',
      immediate: true,
    })
    const started = await next(e)
    await refresh($)

    // Relative times age, and commits made outside Claude Code (another
    // terminal, an IDE) have no event of their own: look every POLL_MS.
    tickTimer?.cancel()
    ticks = 0
    tickTimer = $.clock.every(1000, () => {
      ticks += 1
      void (async () => {
        if (ticks % (POLL_MS / 1000) === 0) await refresh($)
        const flash = await read($, flashA)
        const now = await $.clock.now()
        if (flash && now - flash.at <= FLASH_MS + 1000) $.ui.invalidate('ui.render')
        else if (ticks % 30 === 0) $.ui.invalidate('ui.render')
      })()
    })
    return started
  })

  // Any tool may have run `git commit`, `git push` or changed a file.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    soon($)
    return result
  }).catch(($, e, next) => next(e)) // never in the way of a tool call

  // The prompt you just sent may follow a commit you made by hand.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    soon($, 0)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'last-push' }, async ($, e) => {
    const [cmd = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const prefs = await read($, prefsA)
    const save = async (p: Prefs) => {
      await update($, prefsA, () => p)
      await $.store.set('prefs', p).catch(() => undefined)
      $.ui.invalidate('ui.render')
    }

    if (MODES.includes(cmd as Mode)) {
      await save({ ...prefs, mode: cmd as Mode })
      return { text: `last-push: mode ${cmd}` }
    }
    if (cmd === 'reminders') {
      const value = arg === 'on' ? true : arg === 'off' ? false : !prefs.reminders
      await save({ ...prefs, reminders: value })
      return { text: `last-push: reminders ${value ? 'on' : 'off'}` }
    }
    if (cmd === 'remind') {
      const hours = Number(arg.replace(/h$/, ''))
      if (!arg || !Number.isFinite(hours) || hours < 0 || hours > 720) {
        return { text: `last-push: remind <hours>, e.g. /last-push remind 2 (now ${prefs.remindAfter}h; 0 turns reminders off)` }
      }
      await save({ ...prefs, remindAfter: hours, reminders: hours > 0 ? true : prefs.reminders })
      return { text: hours > 0 ? `last-push: work counts as stale after ${hours}h` : 'last-push: stale colouring and reminders off (remind 0)' }
    }

    // refresh, help, status, or nothing: read again and report.
    await refresh($)
    const now = await $.clock.now()
    const lines = [reportText(await read($, snapA), await read($, prefsA), now)]
    if (cmd !== 'refresh') {
      lines.push(
        '',
        'Commands:',
        '  /last-push                    this report',
        '  /last-push refresh            read the repository again',
        '  /last-push full|compact|off   display',
        '  /last-push reminders on|off   toast when work goes stale',
        '  /last-push remind <hours>     when work counts as stale (0 = never)',
      )
    }
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const prefs = await read($, prefsA)
    const snap = await read($, snapA)
    if (prefs.mode === 'off' || !snap) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const columns = e.viewport?.columns ?? 100
    const compact = prefs.mode === 'compact' || columns < COMPACT_BELOW
    const segs = rowSegs({ snap, prefs, now, compact, flash: await read($, flashA) })
    const text = (s: Seg, k: string) => (
      <Text key={k} color={s.color} backgroundColor={s.bg} dimColor={s.dim} bold={s.bold} wrap="truncate-end">
        {s.text}
      </Text>
    )
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box key="last-push" flexDirection="row">
          {segs.map((s, i) => text(s, `lp-${i}`))}
          {compact ? null : (
            <Box position="absolute" top={0} left={0} right={0} display="none" hover={{ display: 'flex' }} backgroundColor="#30363d">
              <Text color="#e6edf3" wrap="truncate-end">
                {detailText(snap, now)}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
