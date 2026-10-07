# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-07

### Added
- One line under the prompt: branch, the last commit (`commit 12m ago`) and the last push of this
  branch (`↑ pushed 3h ago`), read from the reflog of its remote-tracking ref, so the time is the push,
  not the commit date, and nothing touches the network.
- What is still waiting: commits no remote holds (`⇡2 unpushed`, also without an upstream), changed and
  untracked files (`✎ 4 changed`), and commits the upstream has that you don't (`⇣1 behind`, as of the
  last fetch); `✓ in sync` when there is nothing.
- An age colour from green through yellow to red at `remindAfter` (4 h by default), and a reminder toast
  for stale unpushed commits or uncommitted files, once per state, remembered across sessions.
- A short flash when a commit or a push lands, with a ✨ for the push.
- Honest states for a new branch (`never pushed`), a fresh clone (`no push recorded` / `up to date`),
  a local-only repository (`no remote`) and a detached HEAD; nothing outside a repository.
- A hover card with exact times, the upstream, the last commit's hash and subject, and the last push
  of any branch in the repository.
- Re-reads after every tool call, when a prompt is sent and every 15 s; every git call is read-only and
  runs with `--no-optional-locks`, so it never blocks your own `git commit`.
- `/last-push` (report, `refresh`, `full`/`compact`/`off`, `reminders on|off`, `remind <hours>`),
  `/config` fields `mode`, `reminders`, `remindAfter`; compact form below 80 columns.
- A Node suite that runs the git layer against a real git with a bare remote, an engine suite, drift
  guards for the README, and screenshots rendered from the mod's own renderer.
