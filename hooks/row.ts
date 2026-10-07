/**
 * What is drawn, as plain styled text: the line under the prompt, the hover
 * card, the `/last-push` report and the reminders. Engine-free, so the tests
 * and the screenshot tool use exactly what the mod draws.
 */
import type { Flash, Prefs, Snapshot } from '../types'
import { BLUE, FLASH_MS, GREEN, H, MUTED, YELLOW, age, ago, clockTime, plural, shortPath, tone } from './format'

export type Seg = { text: string; color?: string; bg?: string; dim?: boolean; bold?: boolean }

export type RowInput = {
  snap: Snapshot
  prefs: Prefs
  now: number
  compact: boolean
  flash?: Flash | null
}

const staleMs = (p: Prefs) => Math.max(0, p.remindAfter) * H
const flashing = (f: Flash | null | undefined, kind: Flash['kind'], now: number) => !!f && f.kind === kind && now - f.at < FLASH_MS

/** The short label of the push state, or nothing when there is no remote to push to. */
export function pushState(s: Snapshot): 'pushed' | 'never' | 'unknown' | 'synced' | 'no-remote' {
  if (!s.hasRemote) return 'no-remote'
  if (s.push) return 'pushed'
  if (!s.onRemote) return 'never'
  return s.ahead === 0 ? 'synced' : 'unknown'
}

/** Everything is committed and on the remote. */
export const inSync = (s: Snapshot) => s.hasRemote && s.onRemote && s.ahead === 0 && s.behind === 0 && s.changed === 0 && s.untracked === 0 && !!s.commit

/** The line under the prompt. */
export function rowSegs({ snap: s, prefs, now, compact, flash }: RowInput): Seg[] {
  const stale = staleMs(prefs)
  const out: Seg[] = []
  const sep = () => out.push({ text: compact ? ' ' : ' · ', dim: true })
  const pending = s.ahead > 0

  // branch
  out.push({ text: '⎇ ', dim: true })
  out.push({ text: s.branch, color: BLUE, bold: !compact })
  if (s.detached) out.push({ text: compact ? '!' : ' detached', color: YELLOW })

  // last commit
  sep()
  const cFlash = flashing(flash, 'commit', now)
  if (!s.commit) out.push({ text: compact ? '●–' : 'no commits yet', dim: true })
  else if (compact) out.push({ text: `●${age(now - s.commit.at)}`, color: cFlash ? GREEN : undefined, bold: cFlash, dim: !cFlash })
  else {
    out.push({ text: 'commit ', dim: !cFlash, color: cFlash ? GREEN : undefined, bold: cFlash })
    out.push({ text: ago(now - s.commit.at), color: cFlash ? GREEN : undefined, bold: cFlash })
  }

  // last push
  sep()
  const pFlash = flashing(flash, 'push', now)
  const pushColor = pFlash ? GREEN : pending && s.oldestUnpushed ? tone(now - s.oldestUnpushed.at, stale) : GREEN
  switch (pushState(s)) {
    case 'no-remote':
      out.push({ text: compact ? '↑–' : 'no remote', dim: true })
      break
    case 'never':
      out.push({ text: compact ? '↑never' : '↑ never pushed', color: s.commit ? pushColor : MUTED, dim: !s.commit })
      break
    case 'unknown':
      out.push({ text: compact ? '↑?' : '↑ no push recorded', dim: true })
      break
    case 'synced':
      out.push({ text: compact ? '↑✓' : '↑ up to date', color: GREEN })
      break
    case 'pushed':
      if (compact) out.push({ text: `↑${age(now - s.push!.at)}`, color: pushColor, bold: pFlash })
      else {
        out.push({ text: '↑ pushed ', color: pushColor, dim: !pFlash && !pending })
        out.push({ text: ago(now - s.push!.at), color: pushColor, bold: pFlash })
      }
      break
  }
  if (pFlash) out.push({ text: ' ✨', color: GREEN })

  // what is still waiting
  if (s.ahead > 0) {
    sep()
    const c = s.oldestUnpushed ? tone(now - s.oldestUnpushed.at, stale) : YELLOW
    out.push({ text: compact ? `⇡${s.ahead}` : `⇡${s.ahead} unpushed`, color: c, bold: true })
  }
  if (s.behind > 0) {
    sep()
    out.push({ text: compact ? `⇣${s.behind}` : `⇣${s.behind} behind`, color: YELLOW })
  }
  const files = s.changed + s.untracked
  if (files > 0) {
    sep()
    const c = s.commit ? tone(now - s.commit.at, stale) : YELLOW
    out.push({ text: compact ? `✎${files}` : `✎ ${files} changed`, color: c })
  }
  if (inSync(s)) {
    sep()
    out.push({ text: compact ? '✓' : '✓ in sync', color: GREEN })
  }
  return out
}

/** The hover card: one line with the full picture. */
export function detailText(s: Snapshot, now: number): string {
  const parts = [shortPath(s.root)]
  parts.push(s.upstream ? `${s.branch} → ${s.upstream}` : s.branch)
  if (s.commit) parts.push(`${s.commit.hash} “${s.commit.subject}” ${clockTime(s.commit.at, now)}`)
  if (s.push) parts.push(`pushed ${clockTime(s.push.at, now)}`)
  if (s.repoPush && s.repoPush.ref !== s.push?.ref) parts.push(`repo pushed ${clockTime(s.repoPush.at, now)} (${s.repoPush.ref.replace('refs/remotes/', '')})`)
  parts.push(`${s.ahead} ahead, ${s.behind} behind`)
  parts.push(`${s.changed} changed, ${s.untracked} untracked`)
  return ' ' + parts.join(' · ') + ' '
}

/** The report `/last-push` prints. */
export function reportText(s: Snapshot | null, prefs: Prefs, now: number): string {
  if (!s) return 'last-push: not inside a git repository.'
  const L: string[] = [`last-push · ${shortPath(s.root)}`]
  L.push(`  branch     ${s.branch}${s.detached ? ' (detached HEAD)' : ''}${s.upstream ? ` → ${s.upstream}` : ''}`)
  L.push(s.commit ? `  commit     ${ago(now - s.commit.at)} · ${clockTime(s.commit.at, now)} · ${s.commit.hash} ${s.commit.subject}` : '  commit     none yet')
  const st = pushState(s)
  L.push(
    `  push       ${
      st === 'pushed'
        ? `${ago(now - s.push!.at)} · ${clockTime(s.push!.at, now)} · ${s.push!.ref.replace('refs/remotes/', '')}`
        : st === 'no-remote'
          ? 'no remote configured'
          : st === 'never'
            ? 'this branch was never pushed'
            : st === 'synced'
              ? 'up to date — no push recorded in this clone (cloned or fetched)'
              : 'no push recorded in this clone'
    }`,
  )
  if (s.repoPush && s.repoPush.ref !== s.push?.ref) {
    L.push(`  repo push  ${ago(now - s.repoPush.at)} · ${s.repoPush.ref.replace('refs/remotes/', '')}`)
  }
  L.push(`  unpushed   ${plural(s.ahead, 'commit')}${s.oldestUnpushed ? `, oldest ${ago(now - s.oldestUnpushed.at)}` : ''}`)
  if (s.behind) L.push(`  behind     ${plural(s.behind, 'commit')} (as of the last fetch)`)
  L.push(`  working    ${s.changed} changed, ${s.untracked} untracked`)
  L.push(`  settings   mode ${prefs.mode} · reminders ${prefs.reminders ? 'on' : 'off'} · stale after ${prefs.remindAfter}h`)
  return L.join('\n')
}

export type Reminder = { key: string; text: string }

/**
 * Reminders that are due now. Each has a key that names the state it is about
 * (the oldest unpushed commit, the last commit), so it fires once per state.
 */
export function reminders(s: Snapshot | null, prefs: Prefs, now: number): Reminder[] {
  const stale = staleMs(prefs)
  if (!s || !prefs.reminders || stale <= 0) return []
  const out: Reminder[] = []
  if (s.ahead > 0 && s.oldestUnpushed && s.hasRemote && now - s.oldestUnpushed.at >= stale) {
    out.push({
      key: `unpushed:${s.root}:${s.oldestUnpushed.hash}`,
      text: `⇡ ${plural(s.ahead, 'commit')} on ${s.branch} not pushed for ${age(now - s.oldestUnpushed.at)} — time to push?`,
    })
  }
  const files = s.changed + s.untracked
  if (files > 0 && s.commit && now - s.commit.at >= stale) {
    out.push({
      key: `uncommitted:${s.root}:${s.commit.hash}`,
      text: `✎ ${plural(files, 'file')} changed, last commit ${ago(now - s.commit.at)} — time to commit?`,
    })
  }
  return out
}
