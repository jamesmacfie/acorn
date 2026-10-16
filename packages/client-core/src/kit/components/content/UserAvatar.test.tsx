import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KIT_COMPONENTS } from '../../../host/tree/components'
import { UserAvatar } from './UserAvatar'

// The picture comes from whoever knows the person's code host. A login alone no longer implies GitHub,
// except for a remote tree written before `src` existed.

let host: HTMLElement
let dispose: (() => void) | undefined
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('UserAvatar', () => {
  it('draws the picture it is given', () => {
    dispose = render(() => <UserAvatar login="ada" src="https://gitlab.test/ada.png" />, host)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://gitlab.test/ada.png')
  })

  it('draws initials, not a guessed picture, for a login with no src', () => {
    dispose = render(() => <UserAvatar login="ada-lovelace" />, host)
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toBe('AL')
  })

  it("keeps GitHub's picture for a remote tree that sends only a login", () => {
    const TreeAvatar = KIT_COMPONENTS.UserAvatar as typeof UserAvatar
    dispose = render(() => <TreeAvatar login="octocat" />, host)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://github.com/octocat.png?size=36')
  })
})
