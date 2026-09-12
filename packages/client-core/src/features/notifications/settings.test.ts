// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS, parseNotificationSettings } from './settings'

// The parser is the migration (settings.ts): every shape that is not an explicit `false` has to
// come back on, or an install that has never opened the page goes quiet.
describe('parseNotificationSettings', () => {
  it.each([
    ['no preference', undefined],
    ['an empty blob', '{}'],
    ['a blob that is not JSON', 'not json'],
    ['a blob that is not an object', '"on"'],
    ['a blob with no events', '{"sound":true}'],
    ['a blob whose events is not an object', '{"events":null}'],
  ])('reads %s as everything on', (_name, json) => {
    expect(parseNotificationSettings(json)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('turns off only what the blob says false', () => {
    expect(parseNotificationSettings('{"sound":false,"events":{"finished":false}}')).toEqual({
      sound: false, system: true, badge: true,
      events: { blocked: true, finished: false, error: true },
    })
  })
})
