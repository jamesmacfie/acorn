// The known key index (docs/security/known-key-values.md § The index). It reads the key files on
// this machine and keeps a salted hash of each value worth matching, so a lookup can say a text
// carried the value of `STRIPE_SECRET_KEY` from `.env.local` without the value staying anywhere.
//
// In memory, with a salt drawn at each Node start: the Node keeps running, so nothing here needs to
// outlive it, and a hash on disk would be a guessable copy of a short key. A value lives only inside
// `keysOf` while it is hashed. The extraction rules follow Stroq's `SECRET_NAME` and `EXCLUDED_NAME`, trimmed.
import { createHash, randomBytes } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { KnownKeySource, KnownValueMatch } from '@acorn/protocol/secretChecks.ts'
import { recordAudit } from '../audit'
import type { AppDatabase } from '../db'
import { entropy, PLACEHOLDER } from './detector'

const MIN_VALUE_LENGTH = 12
// Key files are small. A larger one is something else that happens to share the name.
const MAX_SOURCE_BYTES = 256 * 1024
// A lookup reads this much of a text, in overlapping windows, so one huge input can't stall the
// event store and padding can't push a value out of a single bounded pass.
const MAX_SCAN_CHARS = 2 * 1024 * 1024
const WINDOW_CHARS = 256 * 1024
const WINDOW_OVERLAP = 4096
// Task folders the index remembers for Settings. A lookup in a forgotten one reads it again.
const MAX_FOLDERS = 50

const HOME_SOURCES = ['.aws/credentials', '.npmrc', '.netrc', '.docker/config.json']
const PROJECT_ENV = /^(?:\.env(?:\.[\w-]+)*|[\w-][\w.-]*\.env|\.envrc)$/
const EXAMPLE_ENV = /example|sample|template|dist/i
const ENVIRONMENT = "Acorn's environment"

const SECRET_NAME = /key|token|secret|pass(?:word|wd)?|pwd|credential|auth|private|signing|salt|dsn|session|cookie/i
// Names that hold a location or a label even when they contain a secret word: `NEXTAUTH_URL`,
// `SESSION_COOKIE_DOMAIN`, `AWS_ACCESS_KEY_ID`.
const EXCLUDED_NAME =
  /(?:_sock|_path|_dir|_file|_home|_public|public_key|_id|_url|_uri|_endpoint|_host|_hostname|_domain|_region|_name|_header)$/i
// An AWS secret key is base64, which can start with `/`.
const MAY_START_WITH_SLASH = /^aws_secret_access_key$/i
const PATH_LIKE = /^(?:\/|\.\.?\/|~)/
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]+@/i
const HOST_LIKE = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?$/i
// `NAME=VALUE`, with an optional `export`. The name may be an npmrc scope such as
// `//registry.npmjs.org/:_authToken`. `[\s\S]`, so a `\r` before the line break stays in the value
// for `unquote` to trim rather than failing the match.
const KEY_VALUE = /^\s*(?:export\s+)?([A-Za-z_/][\w./:-]*)\s*=([\s\S]*)$/

// Shell, JSON, and URL punctuation. `/` and `@` split only in a second pass, because a password or
// an AWS key can contain them.
const DELIMITERS = /[\s"'`=:&?,;()[\]{}<>|\\#]+/
const SLASH_OR_AT = /[/@]/
const WORD_BOUNDARY = /[\s"'`]+/
const QUOTED = /"([^"]*)"|'([^']*)'|`([^`]*)`/g
// A JSON escape. The white space ones read as a space, so `\nVALUE` in a stored tool input isn't the
// candidate `nVALUE`. The others are matched so an escaped backslash is taken whole.
const JSON_ESCAPE = /\\(?:[nrtbf]|u00[01][0-9a-f]|["\\/]|u[0-9a-f]{4})/gi
const JSON_WHITE_SPACE_ESCAPE = /^\\(?:[nrtbf]|u00[01])/i

type Key = { name: string; value: string }

/** What one source held when it was last read: the hash of each kept value, and its key name. */
type Source = { source: string; folder: string | null; keys: Map<string, string> }

type FileRead = Source & { size: number; mtimeMs: number }

type KnownValueLookup = {
  matches: KnownValueMatch[]
  /** The text ran past the 2 MiB a lookup reads, so the rest wasn't checked. */
  truncated: boolean
}

/** The keys that count for one folder, as they were when it was made. */
export type KnownValueMatcher = {
  /** Changes whenever the keys or their names change, so a cache or an allowance bound to it ends
   *  when a key is added to `.env`. A hash over salted hashes, so it changes at each Node start too. */
  version: string
  lookup(text: string): KnownValueLookup
}

export type KnownValueIndex = {
  /** The keys that count for `folder`: its env files, the home folder files, and the environment.
   *  Reads each source once, so one matcher can check many texts. */
  matcher(folder: string | null): Promise<KnownValueMatcher>
  /** Every known key whose value appears in `text`, for the keys that count for `folder`. */
  lookup(text: string, folder: string | null): Promise<KnownValueLookup>
  /** Every source with a kept key, for Settings: the task folders looked up so far, the home folder
   *  files, and the environment. Names only. */
  sources(): Promise<KnownKeySource[]>
}

const secretName = (name: string): boolean => SECRET_NAME.test(name) && !EXCLUDED_NAME.test(name)

/** Long, unbroken, random, and not a placeholder, a path, a host, or a URL without a password. */
function isKnownValue({ name, value }: Key): boolean {
  if (value.length < MIN_VALUE_LENGTH || /\s/.test(value) || PLACEHOLDER.test(value)) return false
  if (PATH_LIKE.test(value) && !MAY_START_WITH_SLASH.test(name)) return false
  if (URL_SCHEME.test(value) ? !URL_WITH_PASSWORD.test(value) : HOST_LIKE.test(value)) return false
  return entropy(value) >= 3.5
}

/** A value as a dotenv reader takes it: inside its quotes, or up to a ` #` comment. */
function unquote(raw: string): string {
  const value = raw.trim()
  const quote = value[0]
  if (quote !== '"' && quote !== "'") return value.replace(/\s#.*$/, '')
  const end = value.indexOf(quote, 1)
  return end > 0 ? value.slice(1, end) : value.slice(1)
}

/** dotenv, `.envrc`, AWS credentials, and npmrc: `NAME=VALUE` lines under a secret-looking name. */
function keyValueLines(text: string): Key[] {
  return text.split('\n').flatMap((line) => {
    const match = /^\s*[#;]/.test(line) ? null : KEY_VALUE.exec(line)
    return match && secretName(match[1]!) ? [{ name: match[1]!, value: unquote(match[2]!) }] : []
  })
}

/** `~/.netrc`: `machine <host> login <user> password <secret>`, on one line or across several. */
function netrcPasswords(text: string): Key[] {
  const words = text.split(/\s+/)
  const keys: Key[] = []
  let machine = 'default'
  for (let at = 0; at < words.length - 1; at++) {
    if (words[at] === 'machine') machine = words[++at]!
    else if (words[at] === 'password') keys.push({ name: `password (${machine})`, value: words[++at]! })
  }
  return keys
}

/** `~/.docker/config.json`: each registry's `auth`, base64 of `user:password`, and the password. */
function dockerAuths(text: string): Key[] {
  let auths: unknown
  try {
    auths = (JSON.parse(text) as { auths?: unknown } | null)?.auths
  } catch {
    return []
  }
  if (!auths || typeof auths !== 'object') return []
  return Object.entries(auths).flatMap(([registry, entry]) => {
    const auth = (entry as { auth?: unknown } | null)?.auth
    if (typeof auth !== 'string') return []
    const decoded = Buffer.from(auth, 'base64').toString('utf8')
    const password = decoded.includes(':')
      ? [{ name: `password (${registry})`, value: decoded.slice(decoded.indexOf(':') + 1) }]
      : []
    return [{ name: `auth (${registry})`, value: auth }, ...password]
  })
}

function keysInFile(path: string, text: string): Key[] {
  const name = basename(path)
  return name === '.netrc' ? netrcPasswords(text) : name === 'config.json' ? dockerAuths(text) : keyValueLines(text)
}

const environmentKeys = (env: NodeJS.ProcessEnv): Key[] =>
  Object.entries(env).flatMap(([name, value]) => (value && secretName(name) ? [{ name, value }] : []))

/** Every piece of `text` that could be a whole value: quoted strings, words, what follows a word's
 *  first `=` or `:`, and the pieces between punctuation, each also URL-decoded. */
function candidates(text: string): Set<string> {
  const out = new Set<string>()
  const add = (piece: string) => {
    if (piece.length < MIN_VALUE_LENGTH) return
    out.add(piece)
    if (!piece.includes('%')) return
    try {
      out.add(decodeURIComponent(piece))
    } catch {
      // Not percent encoding after all. The piece as written is already a candidate.
    }
  }
  const limit = Math.min(text.length, MAX_SCAN_CHARS)
  for (let start = 0; start < limit; start += WINDOW_CHARS) {
    const window = text
      .slice(Math.max(0, start - WINDOW_OVERLAP), Math.min(start + WINDOW_CHARS, limit))
      .replace(JSON_ESCAPE, (escape) => (JSON_WHITE_SPACE_ESCAPE.test(escape) ? ' ' : escape))
    const quoted = [...window.matchAll(QUOTED)].map((match) => match[1] ?? match[2] ?? match[3]!)
    for (const word of [...quoted, ...window.split(WORD_BOUNDARY)]) {
      if (word.length < MIN_VALUE_LENGTH) continue
      add(word)
      for (const separator of ['=', ':']) if (word.includes(separator)) add(word.slice(word.indexOf(separator) + 1))
    }
    for (const piece of window.split(DELIMITERS)) {
      add(piece)
      for (const part of piece.split(SLASH_OR_AT)) add(part)
    }
  }
  return out
}

export function createKnownValueIndex(options: { home: string; env: NodeJS.ProcessEnv }): KnownValueIndex {
  const salt = randomBytes(16)
  const hash = (value: string) => createHash('sha256').update(salt).update(value).digest('hex')
  const keysOf = (keys: Key[]) => new Map(keys.filter(isKnownValue).map((key) => [hash(key.value), key.name]))
  const tilde = (path: string) =>
    path === options.home || path.startsWith(`${options.home}/`) ? `~${path.slice(options.home.length)}` : path

  const files = new Map<string, FileRead>()
  // Insertion order is recency: a lookup moves its folder to the end.
  const folders = new Set<string>()
  let environment: Source | undefined

  /** The source as it is now, rereading the file when its size or modification time changed. */
  async function readSource(path: string, source: string, folder: string | null): Promise<Source | null> {
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size > MAX_SOURCE_BYTES) {
      files.delete(path)
      return null
    }
    const known = files.get(path)
    if (known?.size === info.size && known.mtimeMs === info.mtimeMs) return known
    const text = await readFile(path, 'utf8').catch(() => null)
    if (text == null) return null
    const read = { source, folder, size: info.size, mtimeMs: info.mtimeMs, keys: keysOf(keysInFile(path, text)) }
    files.set(path, read)
    return read
  }

  async function folderSources(folder: string): Promise<Source[]> {
    const names = await readdir(folder).catch(() => null)
    if (!names) {
      folders.delete(folder)
      return []
    }
    const shown = tilde(folder)
    const envFiles = names.filter((name) => PROJECT_ENV.test(name) && !EXAMPLE_ENV.test(name)).sort()
    const read = await Promise.all(envFiles.map((name) => readSource(join(folder, name), name, shown)))
    return read.filter((source) => source != null)
  }

  const homeSources = async () =>
    (
      await Promise.all(HOME_SOURCES.map((relative) => readSource(join(options.home, relative), `~/${relative}`, null)))
    ).filter((source) => source != null)

  const environmentSource = () =>
    (environment ??= { source: ENVIRONMENT, folder: null, keys: keysOf(environmentKeys(options.env)) })

  async function matcher(folder: string | null): Promise<KnownValueMatcher> {
    if (folder) {
      folders.delete(folder)
      folders.add(folder)
      if (folders.size > MAX_FOLDERS) folders.delete(folders.values().next().value!)
    }
    const sources = [...(folder ? await folderSources(folder) : []), ...(await homeSources()), environmentSource()]
    const entries = sources.map(({ source, keys }) => [source, [...keys].sort(([a], [b]) => (a < b ? -1 : 1))])
    const version = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 32)
    const empty = !sources.some((source) => source.keys.size)
    return {
      version,
      lookup(text) {
        // With no keys, nothing past the limit went unchecked.
        if (empty) return { matches: [], truncated: false }
        const truncated = text.length > MAX_SCAN_CHARS
        const matches = new Map<string, KnownValueMatch>()
        for (const candidate of candidates(text)) {
          const candidateHash = hash(candidate)
          for (const { source, keys } of sources) {
            const name = keys.get(candidateHash)
            if (name) matches.set(`${name}\n${source}`, { name, source })
          }
        }
        return { matches: [...matches.values()], truncated }
      },
    }
  }

  return {
    matcher,
    lookup: async (text, folder) => (await matcher(folder)).lookup(text),

    async sources() {
      const project = (await Promise.all([...folders].reverse().map(folderSources))).flat()
      return [...project, ...(await homeSources()), environmentSource()]
        .filter((source) => source.keys.size)
        .map(({ source, folder, keys }) => ({ source, folder, names: [...new Set(keys.values())].sort() }))
    },
  }
}

let shared: KnownValueIndex | undefined

/** The Node's one index, so Settings lists what the event store looks up against. */
export const knownValueIndex = (): KnownValueIndex =>
  (shared ??= createKnownValueIndex({ home: homedir(), env: process.env }))

/** The known keys a tool call's input carried. A match writes `secrets.agent.carried` with the
 *  session, the call, and the key names. */
export async function auditCarriedKeys(
  db: AppDatabase,
  index: KnownValueIndex,
  input: { sessionId: string; toolCallId: string; folder: string | null; text: string },
): Promise<KnownValueMatch[]> {
  const { matches } = await index.lookup(input.text, input.folder)
  if (matches.length) {
    recordAudit(db, {
      actor: 'system',
      action: 'secrets.agent.carried',
      subject: input.sessionId,
      details: { toolCallId: input.toolCallId, names: [...new Set(matches.map((match) => match.name))].join(',') },
    })
  }
  return matches
}
