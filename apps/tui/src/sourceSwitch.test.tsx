/** @jsxImportSource @acorn/tui/jsx */
import { createResource, lazy } from 'solid-js'
import { expect, it } from 'vitest'
import { renderFixture } from './harness'
import { Button } from './kit/asking'
import { Stack } from './kit/grouping'
import { Heading, Text } from './kit/showing'

it('replaces a resolved source when the next lazy source starts a resource', async () => {
  const screen = await renderFixture({ width: 120, height: 40 })
  const { sourceRegistry } = await import('@acorn/client-core/host/registries/sources')
  const first = sourceRegistry.register({ id: 'first-probe', label: 'First probe', glyph: 'x', order: 9000,
    component: lazy(async () => ({ default: () => <Stack><Heading>Previous source</Heading><Button>Previous action</Button></Stack> })),
  })
  const second = sourceRegistry.register({ id: 'second-probe', label: 'Second probe', glyph: 'x', order: 9001,
    component: lazy(async () => ({ default: () => {
      const [body] = createResource(async () => { await new Promise(resolve => setTimeout(resolve, 50)); return 'Loaded replacement' }, { initialValue: '' })
      return <Stack><Heading>New source</Heading><Text>{body()}</Text><Button>Current action</Button></Stack>
    } })),
  })
  try {
    await screen.press('END')
    await screen.press('ARROW_UP')
    await screen.until('Previous source')
    await screen.press('ARROW_DOWN')
    const frame = await screen.until('Loaded replacement')
    expect(frame).not.toContain('Previous source')
    expect(frame).not.toContain('Previous action')
    await screen.press('RETURN')
    expect((await screen.caret()).text, await screen.frame()).toContain('Current action')
  } finally { screen.done(); first.dispose(); second.dispose() }
}, 30_000)
