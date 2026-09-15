import { For, Show, type Component } from 'solid-js'
import { CodeBlock, Inline, Link, Section, Stack, Text } from '@acorn/plugin-api/ui'
import type { AgentWebActivity, AgentWebResult } from '@acorn/protocol/managedAgents.ts'

/**
 * What an agent did on the web, drawn once for every harness that does it.
 *
 * The provider-neutral half of the tool card: the transcript picks this body over the generic one
 * whenever a driver filled in `AgentToolCall.web`, and nothing in here knows which executable ran.
 * There is no branch on a profile, a harness id or a provider's tool name, by design — a new driver
 * earns this card by mapping its wire shape to `AgentWebActivity` and nothing else
 * (docs/managed-agents.md § Web activity).
 *
 * Kit nodes only, so the terminal host draws the same card. At 80×24 the sections stack, and a
 * focused result link reveals its URL on the line below, which is what that host does with every
 * address it cannot hand to a browser.
 */

/** A URL a reader may click. Parsed rather than pattern-matched, and only two schemes come back: a
 *  provider chooses every character of these strings, and `javascript:`, `data:`, `file:` and an
 *  Acorn deep link are all things a search result must not be able to become. Anything else still
 *  shows — a reader can read it and decide — it just is not a link. */
export function safeWebUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** The host to show beside a result. Codex reports one; Claude Code does not, so it is read off the
 *  URL rather than stored — a derived field in the ledger is a second thing to keep true. */
const resultHost = (result: AgentWebResult): string | undefined => {
  if (result.domain) return result.domain
  try {
    return new URL(result.url).host
  } catch {
    return undefined
  }
}

/** The one line beside the row's title, so a closed card still says which call this was. The first
 *  query, the page's host, or the pattern being looked for — never the whole list and never a long
 *  path, both of which belong inside the card where they can wrap. */
export function webSummary(web: AgentWebActivity): string | undefined {
  const action = web.action
  if (!action) return undefined
  if (action.type === 'search') return action.queries[0]
  if (action.type === 'find_in_page') return action.pattern ?? action.url
  if (action.type === 'other') return undefined
  if (!action.url) return undefined
  try {
    return new URL(action.url).host
  } catch {
    return action.url
  }
}

const WebResultRow: Component<{ result: AgentWebResult }> = (props) => {
  const href = () => safeWebUrl(props.result.url)
  // The URL is the link text when there is no title, so every link says where it goes. A refused
  // scheme keeps the same words without the anchor.
  const label = () => props.result.title || props.result.url
  return (
    <Stack gap="inline">
      <Inline>
        <Show when={href()} fallback={<Text>{label()}</Text>}>
          {(url) => <Link href={url()}>{label()}</Link>}
        </Show>
        <Show when={resultHost(props.result)}>{(host) => <Text emphasis="muted">{host()}</Text>}</Show>
      </Inline>
      <Show when={props.result.snippet}>{(snippet) => <Text emphasis="muted" wrap>{snippet()}</Text>}</Show>
    </Stack>
  )
}

const WebLines: Component<{ label: string; values: string[] }> = (props) => (
  <Show when={props.values.length}>
    <Section label={props.label}>
      <Stack gap="inline">
        <For each={props.values}>{(value) => <Text wrap>{value}</Text>}</For>
      </Stack>
    </Section>
  </Show>
)

/** The open card. Only the sections the provider actually filled in: a harness that reports a query
 *  and nothing else gets a card with a query in it rather than a card with four empty headings. */
export const WebToolBody: Component<{ web: AgentWebActivity; output?: string }> = (props) => {
  const action = () => props.web.action
  const queries = () => {
    const current = action()
    return current?.type === 'search' ? current.queries : []
  }
  const filters = () => {
    const current = action()
    if (current?.type !== 'search') return []
    return [
      ...(current.allowedDomains ?? []).map((domain) => `allowed: ${domain}`),
      ...(current.blockedDomains ?? []).map((domain) => `blocked: ${domain}`),
    ]
  }
  const page = () => {
    const current = action()
    if (!current || current.type === 'search' || current.type === 'other') return []
    return [
      ...(current.url ? [current.url] : []),
      ...(current.type === 'find_in_page' && current.pattern ? [current.pattern] : []),
      ...(current.type === 'fetch_page' && current.prompt ? [current.prompt] : []),
    ]
  }
  return (
    <Stack gap="row">
      <WebLines label="Queries" values={queries()} />
      <WebLines label="Filters" values={filters()} />
      <WebLines label="Page" values={page()} />
      <Show when={props.web.results?.length}>
        <Section label="Results" count={props.web.results?.length}>
          <Stack gap="row">
            <For each={props.web.results}>{(result) => <WebResultRow result={result} />}</For>
          </Stack>
        </Section>
      </Show>
      {/* The provider's own words, kept because a structured mapping is never the whole answer: this
          is where Claude Code's summary of what it read lives, and where a failed call's error is. */}
      <Show when={props.output}>{(output) => <CodeBlock wrap maxHeight="block">{output()}</CodeBlock>}</Show>
    </Stack>
  )
}
