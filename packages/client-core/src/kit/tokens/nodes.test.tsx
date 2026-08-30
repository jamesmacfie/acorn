import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChipRow } from '../components/ChipRow'
import { Facts } from '../components/Facts'
import { Fallback } from '../components/Fallback'
import { Fold } from '../components/Fold'
import { Grid } from '../components/Grid'
import { Heading } from '../components/Heading'
import { Inline } from '../components/Inline'
import { Log } from '../components/Log'
import { Only } from '../components/Only'
import { Section } from '../components/Section'
import { Stack } from '../components/Stack'
import { Timeline } from '../components/Timeline'
import { Chip } from '../components/primitives'

// The ten nodes the kit gained, plus the two host wrappers. What a render adds over the matrix and
// role tests is the part those cannot see: that a role prop reaches the DOM as a token reference
// rather than a value, and that the two wrappers answer for the host this build draws to.

let host: HTMLElement
let dispose: () => void
const mount = (node: () => import('solid-js').JSX.Element) => {
  dispose = render(node, host)
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('grouping nodes', () => {
  it('Stack spends its gap as a role, never as a length', () => {
    mount(() => <Stack gap="section"><span>a</span><span>b</span></Stack>)
    const el = host.querySelector<HTMLElement>('.ui-stack')!
    expect(el.style.getPropertyValue('--kit-gap')).toBe('var(--gap-section)')
    expect(el.children).toHaveLength(2)
  })

  it('Inline wraps only when asked', () => {
    mount(() => <Inline><span>a</span></Inline>)
    expect(host.querySelector('.ui-inline')!.hasAttribute('data-wrap')).toBe(false)
    dispose()
    mount(() => <Inline wrap><span>a</span></Inline>)
    expect(host.querySelector('.ui-inline')!.hasAttribute('data-wrap')).toBe(true)
  })

  it('Section names its group for a screen reader', () => {
    mount(() => <Section label="Needs you" count={2}><span>row</span></Section>)
    expect(host.querySelector('section')!.getAttribute('aria-label')).toBe('Needs you')
    expect(host.querySelector('.ui-section-header-count')!.textContent).toBe('2')
  })

  it('Fold starts where defaultOpen says and reports its own changes', () => {
    const seen: boolean[] = []
    mount(() => <Fold label="Files" defaultOpen><span>child</span></Fold>)
    expect(host.querySelector('details')!.open).toBe(true)
    dispose()
    mount(() => <Fold label="Files" open={false} onOpenChange={(v) => seen.push(v)}><span>child</span></Fold>)
    const details = host.querySelector('details')!
    expect(details.open).toBe(false)
    // Controlled: the caller hears the request, and nothing moves until it answers.
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect(seen).toEqual([true])
  })

  it('Timeline is an ordered list, because the order is the meaning', () => {
    mount(() => (
      <Timeline ariaLabel="Transcript">
        <Timeline.Turn><span>one</span></Timeline.Turn>
        <Timeline.Turn><span>two</span></Timeline.Turn>
      </Timeline>
    ))
    expect(host.querySelector('ol')!.getAttribute('aria-label')).toBe('Transcript')
    expect(host.querySelectorAll('li.ui-timeline-turn')).toHaveLength(2)
  })
})

describe('showing nodes', () => {
  it('Heading puts the eyebrow above a real heading element', () => {
    mount(() => <Heading level={1} eyebrow="RUNN-42">Fix the thing</Heading>)
    expect(host.querySelector('.ui-heading-eyebrow')!.textContent).toBe('RUNN-42')
    expect(host.querySelector('h1')!.textContent).toBe('Fix the thing')
  })

  it('Facts announces each pair', () => {
    mount(() => <Facts items={[{ label: 'State', value: 'open' }, { label: 'Id', value: '42', mono: true }]} />)
    expect([...host.querySelectorAll('dt')].map((n) => n.textContent)).toEqual(['State', 'Id'])
    expect(host.querySelectorAll('dd')[1].hasAttribute('data-mono')).toBe(true)
  })

  it('ChipRow groups its chips only when it has a name to group them under', () => {
    mount(() => <ChipRow ariaLabel="Labels"><Chip>bug</Chip></ChipRow>)
    expect(host.querySelector('.ui-chiprow')!.getAttribute('role')).toBe('group')
    dispose()
    mount(() => <ChipRow><Chip>bug</Chip></ChipRow>)
    expect(host.querySelector('.ui-chiprow')!.getAttribute('role')).toBe(null)
  })

  it('Log draws one element per line and follows only when asked', () => {
    mount(() => <Log ariaLabel="Container logs" lines={['first', 'second']} />)
    expect([...host.querySelectorAll('.ui-log-line')].map((n) => n.textContent)).toEqual(['first', 'second'])
    expect(host.querySelector('pre')!.getAttribute('role')).toBe('log')
  })

  it('Grid draws a header and the rows a viewport can hold', () => {
    mount(() => <Grid ariaLabel="Results" columns={['id', 'name']} rows={[['1', 'ada'], ['2', 'grace']]} selected={1} />)
    const grid = host.querySelector('[role="grid"]')!
    expect(grid.getAttribute('aria-rowcount')).toBe('2')
    expect([...host.querySelectorAll('[role="columnheader"]')].map((n) => n.textContent)).toEqual(['id', 'name'])
  })
})

describe('host wrappers', () => {
  it('Only draws for the host this build is', () => {
    mount(() => <Only hosts={['dom']}><span id="here">yes</span></Only>)
    expect(host.querySelector('#here')).not.toBe(null)
    dispose()
    mount(() => <Only hosts={['tui']}><span id="gone">no</span></Only>)
    expect(host.querySelector('#gone')).toBe(null)
  })

  it('Fallback stays out of the way of a node this host draws fully', () => {
    // Every node is `full` on the DOM, so nothing substitutes for one here. The wrapper exists so a
    // plugin written today still says the right thing on a host that cannot draw the node.
    mount(() => <Fallback forNode="Grid"><span id="sub">a table</span></Fallback>)
    expect(host.querySelector('#sub')).toBe(null)
  })
})
