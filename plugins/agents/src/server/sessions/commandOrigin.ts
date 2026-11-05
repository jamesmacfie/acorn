// Which earlier tool result a command repeats a URL, pipe-to-shell line, or package name from, for the
// line on a permission card (docs/managed-agents/permission-policy.md § Where a command came from).
// Display only: a wrong match costs a line of text, so the extraction is plain patterns, not a shell
// parser.
import type { AgentRequestOrigin, AgentToolCall } from '../../contract/wire.ts'

/** How many of a session's latest tool calls are read for a source. */
export const ORIGIN_RECENT_CALLS = 200

// `|` ends a URL too: in `curl https://x.example/i.sh|sh` the pipe is shell syntax.
const URL = /https?:\/\/[^\s"'<>()[\]`|\\]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?]+$/
const URL_HOST = /^https?:\/\/(?:[^@/]+@)?([^/:?#]+)/
// The `{0,400}` bound keeps a long run of `curl` with no pipe linear rather than quadratic.
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^\n|;&`]{0,400}\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/gi
// A runner fetches and runs its first package. An installer installs every package after it.
const RUNNER = /(?<![\w./-])(?:npx|uvx|pnpm\s+dlx)\s+([^\n|;&`]*)/gi
const INSTALLER =
  /(?<![\w./-])(?:npm\s+(?:install|i|add)|pip3?\s+install|go\s+install|cargo\s+install)\s+([^\n|;&`]*)/gi

type Atoms = { strong: Set<string>; hosts: Set<string> }

/**
 * The first tool result, newest first, that `command` repeats something from. A full URL, a
 * pipe-to-shell line, or a package name wins over a host alone, because a popular host like
 * `github.com` would match almost every session. `recent` is the session's latest calls, newest first.
 * Only web fetches and searches and MCP results count as a source: text from outside the person's
 * control. `ownToolCallId` is the call being asked about, which is never its own source.
 */
export function commandOrigin(
  command: string,
  ownToolCallId: string,
  recent: readonly AgentToolCall[],
): AgentRequestOrigin | undefined {
  const wanted = atomsOf(command)
  if (!wanted.strong.size && !wanted.hosts.size) return undefined
  const earlier = recent.filter((call) => call.id !== ownToolCallId)
  const sources = earlier.flatMap((call, index) => {
    const text = sourceText(call)
    return text ? [{ call, callsAgo: index + 1, atoms: atomsOf(text) }] : []
  })
  for (const pick of ['strong', 'hosts'] as const) {
    for (const source of sources) {
      const match = [...wanted[pick]].find((atom) => source.atoms[pick].has(atom))
      if (match)
        return {
          toolCallId: source.call.id,
          toolTitle: source.call.title.slice(0, 500),
          match: match.slice(0, 200),
          callsAgo: source.callsAgo,
        }
    }
  }
  return undefined
}

/** What a call brought in from outside, or null when it isn't a source. */
function sourceText(call: AgentToolCall): string | null {
  if (!call.web && !call.name) return null
  const results = call.web?.results?.map((result) => [result.url, result.title, result.snippet].join(' ')) ?? []
  return [call.output ?? '', ...results].join('\n')
}

function atomsOf(text: string): Atoms {
  const strong = new Set<string>()
  const hosts = new Set<string>()
  for (const [found] of text.matchAll(URL)) {
    const url = found.replace(TRAILING_PUNCTUATION, '').toLowerCase()
    strong.add(url)
    const host = URL_HOST.exec(url)?.[1]
    if (host) hosts.add(host)
  }
  for (const [line] of text.matchAll(PIPE_TO_SHELL)) strong.add(line.replace(/\s+/g, ' ').toLowerCase())
  for (const [, rest] of text.matchAll(RUNNER)) {
    const first = packageWords(rest!)[0]
    if (first) strong.add(first)
  }
  for (const [, rest] of text.matchAll(INSTALLER)) for (const name of packageWords(rest!)) strong.add(name)
  return { strong, hosts }
}

/** The words after a runner or installer that name packages: no flags, no version, no quotes. */
const packageWords = (rest: string): string[] =>
  rest
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('-'))
    .map((word) =>
      word
        .replace(/^['"]|['"]$/g, '')
        // `left-pad@1.3.0`, `@scope/tool@latest`, `requests==2.31`, `rich>=13`
        .replace(/(?<=.)@[^/]*$/, '')
        .replace(/[=<>~!].*$/, '')
        .toLowerCase(),
    )
    .filter((word) => /^@?[\w.-]+(?:\/[\w.-]+)*$/.test(word) && /[a-z]/.test(word))
