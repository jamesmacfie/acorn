import { For } from 'solid-js'
import type { SuppliedRows } from '@acorn/protocol/dashboards.ts'
import { Link } from '../../kit/components/content/Link'
import { Text } from '../../kit/components/content/Text'

/** Where a panel's supplied rows came from and when the agent read them, so they never pass for live
 *  data. The URLs are `https`, which the plan's schema checked. */
export default function SuppliedOrigin(props: { origin: SuppliedRows['origin'] }) {
  const readAt = () =>
    new Date(props.origin.readAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Text tone="muted" wrap>
      {`From the agent: ${props.origin.says}, read ${readAt()}`}
      <For each={props.origin.urls ?? []}>
        {(url) => (
          <>
            {' · '}
            <Link href={url}>{new URL(url).hostname}</Link>
          </>
        )}
      </For>
    </Text>
  )
}
