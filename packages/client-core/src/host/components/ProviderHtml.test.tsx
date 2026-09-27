import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProviderHtml from './ProviderHtml'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

describe('provider HTML host', () => {
  it('sanitizes first, then adds only host-owned bare reference links', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onText = vi.fn()
    cleanups.push(render(() => (
      <ProviderHtml
        html={'<p onclick="run()">ABC-123 <a href="javascript:run()">bad</a> <a href="https://example.test/ABC-456">ABC-456</a><img src="https://attacker.test/pixel"></p>'}
        refs={new Map([['ABC', 'linear']])}
        onText={onText}
      />
    ), host))
    cleanups.push(() => host.remove())

    const root = host.querySelector('.ui-markdown')
    expect(root?.querySelector('img, script, [onclick]')).toBeNull()
    const links = [...(root?.querySelectorAll('a') ?? [])]
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBeNull()
    expect(links[0].dataset.refProvider).toBe('linear')
    expect(links[0].dataset.refItem).toBe('ABC-123')
    expect(links[1].href).toBe('https://example.test/ABC-456')
    expect(onText).toHaveBeenCalledWith('ABC-123 bad ABC-456')
  })
})
