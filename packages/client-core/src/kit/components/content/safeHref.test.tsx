import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import { Button, Row } from '../primitives'
import { Link } from './Link'

const disposers: Array<() => void> = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })

it('never puts executable Node or tree hrefs on kit anchors', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <>
    <Button href="javascript:alert(1)">Bad button</Button>
    <Link href="data:text/html,evil">Bad link</Link>
    <Row href="file:///tmp/evil">Bad row</Row>
    <Button href="https://example.test/">Good button</Button>
  </>, host)
  disposers.push(() => { dispose(); host.remove() })
  expect([...host.querySelectorAll('a')].map((anchor) => anchor.href)).toEqual(['https://example.test/'])
})
