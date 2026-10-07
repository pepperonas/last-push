/**
 * The git layer: the parsers on fixed output, and `collect()` against a real
 * git in temporary repositories with a bare remote — the same commands the
 * mod runs, so a change in git's output or a wrong flag shows up here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { branchRef, collect, parseHead, parsePushes, parseStatus, parseUnpushed, sameSnap } from '../hooks/git.ts'
import type { Run } from '../hooks/git.ts'

test('parseHead reads time, hash and a subject that may hold tabs', () => {
  assert.deepEqual(parseHead('1791387974\ta1b2c3d\tfix: login\tagain\n'), { at: 1791387974000, hash: 'a1b2c3d', subject: 'fix: login\tagain' })
  assert.equal(parseHead(''), undefined)
  assert.equal(parseHead(undefined), undefined)
  assert.equal(parseHead('garbage'), undefined)
})

test('parsePushes keeps remote-tracking refs only, newest first', () => {
  const out = [
    'refs/remotes/origin/main@{1700000100}',
    'refs/heads/main@{1700000900}',
    'refs/remotes/origin/feature@{1700000500}',
    '',
  ].join('\n')
  assert.deepEqual(parsePushes(out), [
    { ref: 'refs/remotes/origin/feature', at: 1700000500000 },
    { ref: 'refs/remotes/origin/main', at: 1700000100000 },
  ])
  assert.deepEqual(parsePushes(undefined), [])
})

test('parseUnpushed counts commits and finds the oldest', () => {
  assert.deepEqual(parseUnpushed('300\tccc\n100\taaa\n200\tbbb\n'), { ahead: 3, oldest: { at: 100000, hash: 'aaa' } })
  assert.deepEqual(parseUnpushed(''), { ahead: 0, oldest: undefined })
})

test('parseStatus splits changed and untracked, ignores ignored', () => {
  assert.deepEqual(parseStatus(' M a.ts\nM  b.ts\nA  c.ts\n?? new/\n?? x.txt\n!! dist/\n'), { changed: 3, untracked: 2 })
  assert.deepEqual(parseStatus(''), { changed: 0, untracked: 0 })
})

test('branchRef prefers the upstream, else the same-named branch on any remote', () => {
  assert.equal(branchRef('origin/main', 'main', []), 'refs/remotes/origin/main')
  assert.equal(branchRef(undefined, 'feat', ['refs/remotes/origin/main', 'refs/remotes/fork/feat']), 'refs/remotes/fork/feat')
  assert.equal(branchRef(undefined, 'feat', ['refs/remotes/origin/main']), undefined)
  // a suffix match must be a whole path segment
  assert.equal(branchRef(undefined, 'at', ['refs/remotes/origin/feat']), undefined)
})

test('sameSnap compares the whole reading', () => {
  assert.ok(sameSnap(null, null))
  const s = { root: '/r', branch: 'main', detached: false, hasRemote: false, onRemote: false, ahead: 0, behind: 0, changed: 0, untracked: 0 }
  assert.ok(sameSnap(s, { ...s }))
  assert.ok(!sameSnap(s, { ...s, changed: 1 }))
})

// ── against a real git ────────────────────────────────────────────────────

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'last-push-'))
  const remote = join(dir, 'remote.git')
  const work = join(dir, 'work')
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(dir, 'init', '-q', '-b', 'main', work)
  const commit = (msg: string, date?: string) => {
    writeFileSync(join(work, `${msg}.txt`), msg)
    git(work, 'add', '.')
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: work, env: date ? { ...ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : ENV })
  }
  const run: Run = argv =>
    new Promise(res =>
      execFile(argv[0]!, argv.slice(1), { cwd: work, env: ENV }, (err, stdout) =>
        res({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout) }),
      ),
    )
  return { dir, remote, work, git, commit, run, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('not a repository: null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'last-push-none-'))
  try {
    const run: Run = argv => new Promise(res => execFile(argv[0]!, argv.slice(1), { cwd: dir, env: { ...ENV, GIT_CEILING_DIRECTORIES: tmpdir() } }, err => res({ exitCode: err ? 1 : 0, stdout: '' })))
    assert.equal(await collect(run), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a runner that cannot start git: null, no throw', async () => {
  assert.equal(await collect(() => Promise.reject(new Error('ENOENT'))), null)
})

test('a fresh repository: no commits, no remote, untracked files counted', async () => {
  const s = sandbox()
  try {
    writeFileSync(join(s.work, 'a.txt'), 'a')
    const snap = (await collect(s.run))!
    assert.equal(snap.branch, 'main')
    assert.equal(snap.commit, undefined)
    assert.equal(snap.hasRemote, false)
    assert.equal(snap.untracked, 1)
    assert.equal(snap.ahead, 0)
  } finally {
    s.done()
  }
})

test('the whole life of a branch: commit, never pushed, push, ahead, dirty, behind', async () => {
  const s = sandbox()
  try {
    s.commit('one', '2026-10-01T10:00:00Z')
    s.git(s.work, 'remote', 'add', 'origin', s.remote)

    let snap = (await collect(s.run))!
    assert.equal(snap.commit?.subject, 'one')
    assert.equal(snap.commit?.at, Date.parse('2026-10-01T10:00:00Z'))
    assert.equal(snap.hasRemote, true)
    assert.equal(snap.onRemote, false, 'not pushed yet')
    assert.equal(snap.push, undefined)
    assert.equal(snap.ahead, 1)
    assert.equal(snap.oldestUnpushed?.at, Date.parse('2026-10-01T10:00:00Z'))

    const before = Date.now()
    s.git(s.work, 'push', '-q', '-u', 'origin', 'main')
    snap = (await collect(s.run))!
    assert.equal(snap.upstream, 'origin/main')
    assert.equal(snap.onRemote, true)
    assert.ok(snap.push, 'the push is read from the reflog')
    assert.equal(snap.push!.ref, 'refs/remotes/origin/main')
    assert.ok(snap.push!.at >= before - 1000 && snap.push!.at <= Date.now() + 1000, 'push time is when it happened, not the commit time')
    assert.equal(snap.ahead, 0)
    assert.deepEqual(snap.repoPush, snap.push)

    s.commit('two', '2026-10-02T09:00:00Z')
    s.commit('three', '2026-10-02T11:00:00Z')
    writeFileSync(join(s.work, 'one.txt'), 'changed')
    writeFileSync(join(s.work, 'new.txt'), 'new')
    snap = (await collect(s.run))!
    assert.equal(snap.ahead, 2)
    assert.equal(snap.oldestUnpushed?.at, Date.parse('2026-10-02T09:00:00Z'))
    assert.equal(snap.changed, 1)
    assert.equal(snap.untracked, 1)

    // someone else pushes: we fall behind once we fetch
    const other = join(s.dir, 'other')
    s.git(s.dir, 'clone', '-q', s.remote, other)
    writeFileSync(join(other, 'x.txt'), 'x')
    s.git(other, 'add', '.')
    s.git(other, 'commit', '-q', '-m', 'from elsewhere')
    s.git(other, 'push', '-q')
    s.git(s.work, 'fetch', '-q')
    snap = (await collect(s.run))!
    assert.equal(snap.behind, 1)
    assert.equal(snap.ahead, 2)
  } finally {
    s.done()
  }
})

test('a fetch is not a push: a clone shows "no push recorded", not a fake time', async () => {
  const s = sandbox()
  try {
    s.commit('one')
    s.git(s.work, 'remote', 'add', 'origin', s.remote)
    s.git(s.work, 'push', '-q', '-u', 'origin', 'main')
    const clone = join(s.dir, 'clone')
    s.git(s.dir, 'clone', '-q', s.remote, clone)
    const run: Run = argv => new Promise(res => execFile(argv[0]!, argv.slice(1), { cwd: clone, env: ENV }, (err, out) => res({ exitCode: err ? 1 : 0, stdout: String(out) })))
    const snap = (await collect(run))!
    assert.equal(snap.onRemote, true)
    assert.equal(snap.push, undefined)
    assert.equal(snap.ahead, 0)
  } finally {
    s.done()
  }
})

test('a branch pushed without -u is found by name; the repo push is the newest of all', async () => {
  const s = sandbox()
  try {
    s.commit('one')
    s.git(s.work, 'remote', 'add', 'origin', s.remote)
    s.git(s.work, 'push', '-q', '-u', 'origin', 'main')
    s.git(s.work, 'switch', '-q', '-c', 'feat')
    s.commit('two')
    let snap = (await collect(s.run))!
    assert.equal(snap.upstream, undefined)
    assert.equal(snap.onRemote, false)
    assert.equal(snap.push, undefined)
    assert.equal(snap.repoPush?.ref, 'refs/remotes/origin/main', 'the repo was pushed, this branch not')
    assert.equal(snap.ahead, 1)

    s.git(s.work, 'push', '-q', 'origin', 'feat')
    snap = (await collect(s.run))!
    assert.equal(snap.upstream, undefined)
    assert.equal(snap.push?.ref, 'refs/remotes/origin/feat')
    assert.equal(snap.repoPush?.ref, snap.push?.ref)
    assert.equal(snap.ahead, 0)
  } finally {
    s.done()
  }
})

test('detached HEAD shows the short hash', async () => {
  const s = sandbox()
  try {
    s.commit('one')
    s.commit('two')
    s.git(s.work, 'checkout', '-q', 'HEAD~1')
    const snap = (await collect(s.run))!
    assert.equal(snap.detached, true)
    assert.match(snap.branch, /^[0-9a-f]{7,}$/)
    assert.equal(snap.commit?.subject, 'one')
    assert.equal(snap.onRemote, false, 'no remote at all')

    // checked out from a pushed history: it is on the remote, not "never pushed"
    s.git(s.work, 'remote', 'add', 'origin', s.remote)
    s.git(s.work, 'push', '-q', 'origin', 'HEAD@{1}:refs/heads/main')
    s.git(s.work, 'fetch', '-q')
    const on = (await collect(s.run))!
    assert.equal(on.detached, true)
    assert.equal(on.ahead, 0)
    assert.equal(on.onRemote, true)
  } finally {
    s.done()
  }
})

test('every command runs with --no-optional-locks, so it never takes index.lock', async () => {
  const seen: string[][] = []
  await collect(async argv => {
    seen.push([...argv])
    return { exitCode: 0, stdout: '' }
  })
  assert.ok(seen.length >= 10)
  for (const a of seen) assert.deepEqual(a.slice(0, 2), ['git', '--no-optional-locks'])
})
