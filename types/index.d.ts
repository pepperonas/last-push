export type Mode = 'full' | 'compact' | 'off'

export type Prefs = {
  mode: Mode
  /** A toast when work has sat unpushed or uncommitted this long. */
  reminders: boolean
  /** Hours before work counts as stale: the colour reaches red, the reminder fires. */
  remindAfter: number
}

/** A commit: committer time (ms), short hash, subject. */
export type Commit = { at: number; hash: string; subject: string }

/** A push recorded in a remote-tracking ref's reflog. */
export type Push = { at: number; ref: string }

/** Everything the line shows about the repository the session runs in. */
export type Snapshot = {
  /** The work tree's top folder. */
  root: string
  /** Branch name, or the short hash when HEAD is detached. */
  branch: string
  detached: boolean
  /** HEAD; absent in a repository without commits. */
  commit?: Commit
  /** The branch's upstream, e.g. `origin/main`. */
  upstream?: string
  /** Whether the repository has any remote at all. */
  hasRemote: boolean
  /** Whether a remote-tracking ref for this branch exists. */
  onRemote: boolean
  /** The last push of this branch. */
  push?: Push
  /** The last push of any branch in this repository. */
  repoPush?: Push
  /** Commits on HEAD that no remote-tracking ref holds. */
  ahead: number
  /** The oldest of them. */
  oldestUnpushed?: { at: number; hash: string }
  /** Commits on the upstream that HEAD lacks (as of the last fetch). */
  behind: number
  /** Tracked files with changes, staged or not. */
  changed: number
  /** Untracked files (a new folder counts once). */
  untracked: number
}

/** A short highlight after a commit or a push was noticed. */
export type Flash = { kind: 'commit' | 'push'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'last-push': {
      snap: Snapshot | null
      prefs: Prefs
      flash: Flash | null
    }
  }
}
