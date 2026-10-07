import { test } from 'node:test'
import assert from 'node:assert/strict'

import { D, GREEN, H, MIN, RED, YELLOW, age, ago, clockTime, plural, shortPath, tone } from '../hooks/format.ts'

test('age: the short form steps through the units', () => {
  assert.equal(age(0), 'now')
  assert.equal(age(59_000), 'now')
  assert.equal(age(MIN), '1m')
  assert.equal(age(59 * MIN), '59m')
  assert.equal(age(H), '1h')
  assert.equal(age(23 * H + 59 * MIN), '23h')
  assert.equal(age(D), '1d')
  assert.equal(age(13 * D), '13d')
  assert.equal(age(14 * D), '2w')
  assert.equal(age(60 * D), '2mo')
  assert.equal(age(400 * D), '1y')
})

test('age: a time in the future (clock skew) reads as now, not negative', () => {
  assert.equal(age(-5 * MIN), 'now')
})

test('ago: "just now" and "12m ago"', () => {
  assert.equal(ago(10_000), 'just now')
  assert.equal(ago(12 * MIN), '12m ago')
})

test('clockTime: today a time, this year a date, older a year', () => {
  const now = new Date(2026, 9, 7, 18, 0).getTime()
  assert.equal(clockTime(new Date(2026, 9, 7, 9, 5).getTime(), now), '09:05')
  assert.equal(clockTime(new Date(2026, 9, 5, 14, 2).getTime(), now), 'Oct 5 14:02')
  assert.equal(clockTime(new Date(2025, 0, 3, 14, 2).getTime(), now), 'Jan 3 2025')
})

test('tone: green fresh, yellow halfway, red from stale on', () => {
  assert.equal(tone(0, 4 * H), GREEN)
  assert.equal(tone(2 * H, 4 * H), YELLOW)
  assert.equal(tone(4 * H, 4 * H), RED)
  assert.equal(tone(40 * H, 4 * H), RED)
  // in between it is a real mix, not a jump
  const mid = tone(H, 4 * H)
  assert.notEqual(mid, GREEN)
  assert.notEqual(mid, YELLOW)
  // stale time 0 means: never stale
  assert.equal(tone(100 * H, 0), GREEN)
})

test('plural and shortPath', () => {
  assert.equal(plural(1, 'commit'), '1 commit')
  assert.equal(plural(3, 'commit'), '3 commits')
  assert.equal(shortPath('/Users/me/src/shop'), '~/src/shop')
  assert.equal(shortPath('/home/me/x'), '~/x')
  assert.equal(shortPath('/srv/app'), '/srv/app')
})
