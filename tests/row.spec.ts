import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Prefs, Snapshot } from '../types/index.d.ts'
import { GREEN, H, MIN, RED } from '../hooks/format.ts'
import { detailText, inSync, pushState, reminders, reportText, rowSegs } from '../hooks/row.ts'
import type { RowInput } from '../hooks/row.ts'

const NOW = new Date(2026, 9, 7, 18, 0).getTime()
const PREFS: Prefs = { mode: 'full', reminders: true, remindAfter: 4 }
const BASE: Snapshot = {
  root: '/Users/me/src/shop',
  branch: 'main',
  detached: false,
  commit: { at: NOW - 12 * MIN, hash: 'a1b2c3d', subject: 'fix login' },
  upstream: 'origin/main',
  hasRemote: true,
  onRemote: true,
  push: { at: NOW - 3 * H, ref: 'refs/remotes/origin/main' },
  repoPush: { at: NOW - 3 * H, ref: 'refs/remotes/origin/main' },
  ahead: 0,
  behind: 0,
  changed: 0,
  untracked: 0,
}
const line = (snap: Partial<Snapshot>, more: Partial<RowInput> = {}) =>
  rowSegs({ snap: { ...BASE, ...snap }, prefs: PREFS, now: NOW, compact: false, ...more })
const text = (snap: Partial<Snapshot>, more: Partial<RowInput> = {}) => line(snap, more).map(s => s.text).join('')

test('the line: branch, commit age, push age, in sync', () => {
  assert.equal(text({}), '⎇ main · commit 12m ago · ↑ pushed 3h ago · ✓ in sync')
})

test('unpushed commits, behind and changed files each get a segment', () => {
  const t = text({ ahead: 2, oldestUnpushed: { at: NOW - H, hash: 'b' }, behind: 1, changed: 3, untracked: 1 })
  assert.match(t, /⇡2 unpushed/)
  assert.match(t, /⇣1 behind/)
  assert.match(t, /✎ 4 changed/)
  assert.doesNotMatch(t, /in sync/)
})

test('unpushed work turns red once it is older than remindAfter', () => {
  const seg = (ageMs: number) => line({ ahead: 1, oldestUnpushed: { at: NOW - ageMs, hash: 'b' } }).find(s => s.text.includes('unpushed'))!
  assert.equal(seg(0).color, GREEN)
  assert.equal(seg(5 * H).color, RED)
  // the push age is coloured by the same waiting work
  assert.equal(line({ ahead: 1, oldestUnpushed: { at: NOW - 5 * H, hash: 'b' } }).find(s => s.text.includes('pushed '))!.color, RED)
})

test('uncommitted files age with the last commit', () => {
  const seg = line({ changed: 2, commit: { ...BASE.commit!, at: NOW - 6 * H } }).find(s => s.text.includes('changed'))!
  assert.equal(seg.color, RED)
})

test('push states: no remote, never pushed, no push recorded, up to date', () => {
  assert.equal(pushState({ ...BASE, hasRemote: false }), 'no-remote')
  assert.equal(pushState({ ...BASE, push: undefined, onRemote: false }), 'never')
  assert.equal(pushState({ ...BASE, push: undefined, ahead: 2 }), 'unknown')
  assert.equal(pushState({ ...BASE, push: undefined }), 'synced')
  assert.match(text({ hasRemote: false, push: undefined, onRemote: false }), /no remote/)
  assert.match(text({ push: undefined, onRemote: false, ahead: 1 }), /↑ never pushed/)
  assert.match(text({ push: undefined, ahead: 1 }), /no push recorded/)
  assert.match(text({ push: undefined }), /↑ up to date/)
})

test('no commits yet, detached HEAD', () => {
  assert.match(text({ commit: undefined, onRemote: false, push: undefined }), /no commits yet/)
  assert.match(text({ branch: 'a1b2c3d', detached: true }), /⎇ a1b2c3d detached/)
})

test('in sync needs a remote copy, nothing ahead and a clean tree', () => {
  assert.ok(inSync(BASE))
  assert.ok(!inSync({ ...BASE, untracked: 1 }))
  assert.ok(!inSync({ ...BASE, ahead: 1 }))
  assert.ok(!inSync({ ...BASE, hasRemote: false }))
  assert.ok(!inSync({ ...BASE, onRemote: false }))
  assert.ok(!inSync({ ...BASE, behind: 2 }), 'behind is not in sync')
})

test('compact: symbols only, still every fact', () => {
  const t = text({ ahead: 2, oldestUnpushed: { at: NOW - H, hash: 'b' }, changed: 4 }, { compact: true })
  assert.equal(t, '⎇ main ●12m ↑3h ⇡2 ✎4')
  assert.equal(text({}, { compact: true }), '⎇ main ●12m ↑3h ✓')
})

test('a push that was just noticed flashes, then settles', () => {
  const on = line({ push: { ...BASE.push!, at: NOW - 1000 } }, { flash: { kind: 'push', at: NOW - 1000 } })
  assert.ok(on.some(s => s.text.includes('✨')))
  const off = line({ push: { ...BASE.push!, at: NOW - 1000 } }, { flash: { kind: 'push', at: NOW - 10_000 } })
  assert.ok(!off.some(s => s.text.includes('✨')))
  const commit = line({}, { flash: { kind: 'commit', at: NOW - 500 } }).find(s => s.text === '12m ago')!
  assert.ok(commit.bold)
})

test('hover card and report carry the absolute times and the refs', () => {
  const d = detailText({ ...BASE, repoPush: { at: NOW - H, ref: 'refs/remotes/origin/feat' } }, NOW)
  assert.match(d, /~\/src\/shop/)
  assert.match(d, /main → origin\/main/)
  assert.match(d, /a1b2c3d “fix login” 17:48/)
  assert.match(d, /pushed 15:00/)
  assert.match(d, /repo pushed 17:00 \(origin\/feat\)/)
  const r = reportText(BASE, PREFS, NOW)
  assert.match(r, /push +3h ago · 15:00 · origin\/main/)
  assert.match(r, /stale after 4h/)
  assert.match(reportText(null, PREFS, NOW), /not inside a git repository/)
})

test('reminders: due once stale, keyed by the state they are about, silent when off', () => {
  const stale = { ...BASE, ahead: 3, oldestUnpushed: { at: NOW - 5 * H, hash: 'old1' }, changed: 2, commit: { ...BASE.commit!, at: NOW - 5 * H } }
  const due = reminders(stale, PREFS, NOW)
  assert.equal(due.length, 2)
  assert.equal(due[0]!.key, 'unpushed:/Users/me/src/shop:old1')
  assert.match(due[0]!.text, /3 commits on main not pushed for 5h/)
  assert.match(due[1]!.text, /2 files changed, last commit 5h ago/)
  assert.deepEqual(reminders(stale, { ...PREFS, reminders: false }, NOW), [])
  assert.deepEqual(reminders(stale, { ...PREFS, remindAfter: 0 }, NOW), [])
  assert.deepEqual(reminders(stale, { ...PREFS, remindAfter: 6 }, NOW), [])
  // nothing to push to: no push reminder
  assert.equal(reminders({ ...stale, hasRemote: false }, PREFS, NOW).length, 1)
  assert.deepEqual(reminders(null, PREFS, NOW), [])
})
