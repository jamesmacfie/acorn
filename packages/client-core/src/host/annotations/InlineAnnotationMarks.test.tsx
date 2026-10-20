import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginAnnotationMark } from '@acorn/protocol/extensionPoints.ts'
import { clearAnnotations, requestAnnotations } from './annotations'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'
import { InlineAnnotationMarks } from './InlineAnnotationMarks'

vi.mock('../plugins/surfaceFailures', () => ({ recordSurfaceFailure: vi.fn() }))

// Marks on one line after a row's title, with their detail on hover and focus. What a person relies
// on: the words they can see, a name that lists every mark, and detail that is sanitized and credited.

const POINT = 'owner:session'
const registered: Disposable[] = []
let dispose: (() => void) | undefined

const setup = (marks: PluginAnnotationMark[]) => {
  registered.push(
    extensionPointRegistry.register({
      id: POINT,
      ownerId: 'owner',
      label: 'Session',
      kind: 'annotation',
      key: ['session'],
      max: 2,
      acceptsDetail: true,
    }),
    extensionRegistry.register({
      id: 'plugin:health:sessions',
      pluginId: 'health',
      point: POINT,
      label: 'Session health',
      order: 500,
      carrier: 'items',
      marks: async () => marks,
    } as ExtensionContribution),
  )
  requestAnnotations(POINT, [{ session: 's1' }])
}

const draw = (dotsOnly = false) => {
  const host = document.createElement('div')
  document.body.append(host)
  const stop = render(
    () => <InlineAnnotationMarks point={POINT} itemKey={{ session: 's1' }} dotsOnly={dotsOnly} />,
    host,
  )
  dispose = () => {
    stop()
    host.remove()
  }
  return host
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  clearAnnotations()
})

describe('InlineAnnotationMarks', () => {
  it('draws nothing for an item nobody marked', async () => {
    setup([{ key: { session: 'other' }, severity: 'warn', text: 'Watch' }])
    const host = draw()
    await Promise.resolve()
    expect(host.innerHTML).toBe('')
  })

  it('draws up to the point’s max, and names every mark with its plugin', async () => {
    setup([
      { key: { session: 's1' }, severity: 'danger', text: 'Struggling' },
      { key: { session: 's1' }, severity: 'info', text: 'Long run' },
      { key: { session: 's1' }, severity: 'warn', text: 'Costly' },
    ])
    const host = draw()
    await vi.waitFor(() => expect(host.querySelector('button.annotation-inline')).not.toBeNull())
    const button = host.querySelector('button.annotation-inline')!
    expect([...button.querySelectorAll('.annotation-inline-text')].map((el) => el.textContent)).toEqual([
      'Struggling',
      'Long run',
    ])
    expect(button.getAttribute('aria-label')).toBe(
      'Struggling, from health; Long run, from health; Costly, from health',
    )
  })

  it('draws dots without words when asked, keeping the words in the name', async () => {
    setup([{ key: { session: 's1' }, severity: 'warn', text: 'Watch' }])
    const host = draw(true)
    await vi.waitFor(() => expect(host.querySelector('button.annotation-inline')).not.toBeNull())
    expect(host.querySelector('.annotation-inline-text')).toBeNull()
    expect(host.querySelector('.ui-dot')).not.toBeNull()
    expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('Watch, from health')
  })

  it('opens sanitized, credited detail on focus, and drops a javascript: link', async () => {
    setup([
      {
        key: { session: 's1' },
        severity: 'danger',
        text: 'Struggling',
        detail: {
          kind: 'markdown',
          value: '- **5** failed commands\n- [trap](javascript:alert(1)) [ok](https://example.com)',
        },
      },
    ])
    const host = draw()
    await vi.waitFor(() => expect(host.querySelector('button.annotation-inline')).not.toBeNull())
    const button = host.querySelector<HTMLButtonElement>('button.annotation-inline')!
    button.focus()
    const detail = document.querySelector<HTMLElement>('.annotation-detail')
    expect(detail).not.toBeNull()
    expect(button.getAttribute('aria-describedby')).toBe(detail!.id)
    expect(detail!.querySelector('strong')?.textContent).toBe('5')
    expect(detail!.textContent).toContain('trap')
    const links = [...detail!.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '')
    expect(links.every((href) => href.startsWith('https://'))).toBe(true)
    expect(detail!.querySelector('.cm-document-hover-from')?.textContent).toBe('From health')

    button.blur()
    await vi.waitFor(() => expect(document.querySelector('.annotation-detail')).toBeNull())
  })
})
