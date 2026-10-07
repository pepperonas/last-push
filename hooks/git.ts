/**
 * Reading the repository: which git commands run, and what their output means.
 * Pure apart from the runner it is handed, so the same code runs in the mod
 * (`$.process.run`) and in the tests (a real `git` in a temporary folder).
 *
 * Nothing here talks to a remote. The push time comes from the reflog of the
 * remote-tracking ref: every `git push` that moves `refs/remotes/<r>/<b>`
 * writes an entry `update by push` with the time it happened.
 */
import type { Commit, Push, Snapshot } from '../types'

export type RunResult = { exitCode: number; stdout: string }
export type Run = (argv: readonly string[]) => Promise<RunResult>

/** `--no-optional-locks`: never take index.lock, so a refresh can't collide with your own `git commit`. */
export const GIT = ['git', '--no-optional-locks'] as const

const ok = async (run: Run, args: readonly string[]): Promise<string | undefined> => {
  try {
    const r = await run([...GIT, ...args])
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

/** `%ct\t%h\t%s` of `git log -1`. */
export function parseHead(out: string | undefined): Commit | undefined {
  const line = out?.split('\n')[0]?.trim()
  if (!line) return undefined
  const [ct, hash, ...subject] = line.split('\t')
  const at = Number(ct) * 1000
  if (!Number.isFinite(at) || !hash) return undefined
  return { at, hash, subject: subject.join('\t') }
}

/** `%gD` lines of `git log -g --date=unix`, e.g. `refs/remotes/origin/main@{1791387974}`. Newest first. */
export function parsePushes(out: string | undefined): Push[] {
  const pushes: Push[] = []
  for (const line of (out ?? '').split('\n')) {
    const m = /^(refs\/remotes\/.+)@\{(\d+)\}$/.exec(line.trim())
    if (m) pushes.push({ ref: m[1]!, at: Number(m[2]) * 1000 })
  }
  return pushes.sort((a, b) => b.at - a.at)
}

/** `%ct\t%h` lines of the commits no remote holds: count and the oldest one. */
export function parseUnpushed(out: string | undefined): { ahead: number; oldest?: { at: number; hash: string } } {
  let ahead = 0
  let oldest: { at: number; hash: string } | undefined
  for (const line of (out ?? '').split('\n')) {
    const [ct, hash] = line.trim().split('\t')
    const at = Number(ct) * 1000
    if (!hash || !Number.isFinite(at)) continue
    ahead += 1
    if (!oldest || at < oldest.at) oldest = { at, hash }
  }
  return { ahead, oldest }
}

/** `git status --porcelain`: changed tracked files and untracked entries. */
export function parseStatus(out: string | undefined): { changed: number; untracked: number } {
  let changed = 0
  let untracked = 0
  for (const line of (out ?? '').split('\n')) {
    if (line.length < 3) continue
    if (line.startsWith('??')) untracked += 1
    else if (!line.startsWith('!!')) changed += 1
  }
  return { changed, untracked }
}

/** Which remote-tracking ref stands for this branch: the upstream, else `<any remote>/<branch>`. */
export function branchRef(upstream: string | undefined, branch: string, refs: readonly string[]): string | undefined {
  if (upstream) return `refs/remotes/${upstream}`
  return refs.find(r => r.endsWith(`/${branch}`) && r.startsWith('refs/remotes/'))
}

/**
 * Read the repository the runner points at. `null` when it is not a git work
 * tree (or git is missing): the mod then shows nothing.
 */
export async function collect(run: Run): Promise<Snapshot | null> {
  const top = await ok(run, ['rev-parse', '--show-toplevel'])
  if (top === undefined) return null
  const root = top.trim()

  const [sym, head, short, up, remotes, refs, pushes, unpushed, behind, status] = await Promise.all([
    ok(run, ['symbolic-ref', '--short', '-q', 'HEAD']),
    ok(run, ['log', '-1', '--format=%ct%x09%h%x09%s']),
    ok(run, ['rev-parse', '--short', 'HEAD']),
    ok(run, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ok(run, ['remote']),
    ok(run, ['for-each-ref', '--format=%(refname)', 'refs/remotes']),
    ok(run, ['log', '-g', '--all', '--grep-reflog=update by push', '--date=unix', '--format=%gD']),
    ok(run, ['log', '--format=%ct%x09%h', 'HEAD', '--not', '--remotes']),
    ok(run, ['rev-list', '--count', 'HEAD..@{u}']),
    ok(run, ['status', '--porcelain']),
  ])

  const detached = sym === undefined
  const branch = (detached ? short?.trim() : sym.trim()) || 'HEAD'
  const upstream = up?.trim() || undefined
  const refList = (refs ?? '').split('\n').map(r => r.trim()).filter(Boolean)
  const ref = detached ? undefined : branchRef(upstream, branch, refList)
  const all = parsePushes(pushes)
  const { ahead, oldest } = parseUnpushed(unpushed)
  const { changed, untracked } = parseStatus(status)

  return {
    root,
    branch,
    detached,
    commit: parseHead(head),
    upstream,
    hasRemote: (remotes ?? '').trim().length > 0,
    // a detached HEAD has no branch ref: it is on the remote when no commit of it is missing there
    onRemote: detached ? unpushed !== undefined && ahead === 0 && refList.length > 0 : !!ref && refList.includes(ref),
    push: ref ? all.find(p => p.ref === ref) : undefined,
    repoPush: all[0],
    ahead,
    oldestUnpushed: oldest,
    behind: Number((behind ?? '').trim()) || 0,
    changed,
    untracked,
  }
}

/** Whether two readings would draw the same line (times included). */
export const sameSnap = (a: Snapshot | null, b: Snapshot | null): boolean => JSON.stringify(a) === JSON.stringify(b)
