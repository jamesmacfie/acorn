import { describe, expect, it } from 'vitest'
import { bucketValue, repeatingBucketChoices } from './planBuckets'

const at = (iso: string) => Date.parse(iso)

describe('hour and weekday buckets', () => {
  it('reads the hour and weekday in the plan zone', () => {
    const instant = at('2026-10-20T01:30:00Z')
    expect(bucketValue(instant, 'hour', 'UTC', 'monday')).toBe('01')
    expect(bucketValue(instant, 'hour', 'Pacific/Auckland', 'monday')).toBe('14')
    expect(bucketValue(instant, 'hour', 'America/Los_Angeles', 'monday')).toBe('18')
    expect(bucketValue(instant, 'weekday', 'UTC', 'monday')).toBe('tue')
    expect(bucketValue(instant, 'weekday', 'Pacific/Auckland', 'monday')).toBe('tue')
    expect(bucketValue(instant, 'weekday', 'America/Los_Angeles', 'monday')).toBe('mon')
  })

  it('reads the wall clock across a change to and from daylight saving time', () => {
    const zone = 'America/New_York'
    // 2:00 to 3:00 on March 8, 2026: the hour 02 never happens.
    expect(bucketValue(at('2026-03-08T06:30:00Z'), 'hour', zone, 'monday')).toBe('01')
    expect(bucketValue(at('2026-03-08T07:30:00Z'), 'hour', zone, 'monday')).toBe('03')
    // 2:00 back to 1:00 on November 1, 2026: the hour 01 happens twice.
    expect(bucketValue(at('2026-11-01T05:30:00Z'), 'hour', zone, 'monday')).toBe('01')
    expect(bucketValue(at('2026-11-01T06:30:00Z'), 'hour', zone, 'monday')).toBe('01')
    expect(bucketValue(at('2026-11-01T06:30:00Z'), 'weekday', zone, 'monday')).toBe('sun')
  })

  it('takes a date with no time as its own day, with no hour', () => {
    expect(bucketValue('2026-10-20', 'weekday', 'Pacific/Auckland', 'monday')).toBe('tue')
    expect(bucketValue('2026-10-20', 'hour', 'Pacific/Auckland', 'monday')).toBeNull()
    expect(bucketValue(null, 'hour', 'UTC', 'monday')).toBeNull()
  })

  it('lists every value in order, the week from its start', () => {
    expect(repeatingBucketChoices('hour', 'monday').map((choice) => choice.id)).toEqual(
      Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')),
    )
    expect(repeatingBucketChoices('hour', 'monday')[14]).toEqual({ id: '14', label: '14:00' })
    const week = (start: 'monday' | 'sunday' | 'saturday') =>
      repeatingBucketChoices('weekday', start).map((choice) => choice.id)
    expect(week('monday')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    expect(week('sunday')).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
    expect(week('saturday')).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'])
    expect(repeatingBucketChoices('weekday', 'monday')[0]).toEqual({ id: 'mon', label: 'Monday' })
  })
})
