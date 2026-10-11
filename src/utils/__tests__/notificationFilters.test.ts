import { describe, it, expect } from 'vitest'
import { sinceSignup } from '../notificationFilters'

const items = [
  { id: 'before', timestamp: '2026-01-10T09:00:00Z' },
  { id: 'same-instant', timestamp: '2026-02-01T12:00:00Z' },
  { id: 'after', timestamp: '2026-03-05T08:30:00Z' },
  { id: 'epoch', timestamp: new Date(0).toISOString() },
  { id: 'garbage', timestamp: 'not-a-date' },
]

describe('sinceSignup', () => {
  it('keeps only items at or after the signup instant', () => {
    expect(sinceSignup(items, '2026-02-01T12:00:00Z').map(i => i.id)).toEqual(['same-instant', 'after'])
  })
  it('drops undated and unparsable items once a signup date is known', () => {
    const ids = sinceSignup(items, '2025-01-01T00:00:00Z').map(i => i.id)
    expect(ids).not.toContain('garbage')
    expect(ids).not.toContain('epoch')
  })
  it('keeps everything when the signup date is missing or invalid', () => {
    expect(sinceSignup(items, undefined)).toHaveLength(items.length)
    expect(sinceSignup(items, 'nope')).toHaveLength(items.length)
  })
})
