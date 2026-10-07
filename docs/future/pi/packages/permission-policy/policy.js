import { isAbsolute, relative, resolve } from 'node:path'

// Hard-coded rules over the command line a harness asked permission to run: two that refuse, and three
// that only warn. These are examples, not containment: a command the harness doesn't ask about, or a
// script that does the same thing, never reaches them. README.md lists the forms they recognise.

const DESTRUCTIVE = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate'])

// Words, with single and double quotes honoured, split into simple commands at `;`, `&&`, `||`, `|`
// and newlines. No expansion: a `$VAR` or `~` operand stays as written.
export function simpleCommands(line) {
  const commands = [[]]
  let word = null
  let quote = null
  const end = () => { if (word !== null) commands.at(-1).push(word); word = null }
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      word ??= ''
    } else if (/\s/.test(char) && char !== '\n') {
      end()
    } else if (char === ';' || char === '|' || char === '\n' || (char === '&' && line[index + 1] === '&')) {
      end()
      if (line[index + 1] === char) index++
      commands.push([])
    } else {
      word = (word ?? '') + char
    }
  }
  end()
  return commands.filter((words) => words.length)
}

// `sudo` and leading `NAME=value` assignments don't change what runs.
const program = (words) => {
  let start = 0
  while (start < words.length && (words[start] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]))) start++
  return words.slice(start)
}

// Whether this is `git … push`, past git's own options and the values `-C` and `-c` take. Returns the
// push's arguments, or null.
function gitPushArgs(words) {
  if (words[0] !== 'git') return null
  let index = 1
  while (index < words.length && words[index].startsWith('-')) index += words[index] === '-C' || words[index] === '-c' ? 2 : 1
  return words[index] === 'push' ? words.slice(index + 1) : null
}

function isForcePush(words) {
  return !!gitPushArgs(words)?.some((arg) =>
    arg === '--force' || arg.startsWith('--force-with-lease') || arg === '--force-if-includes'
    || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)
    || (arg.startsWith('+') && arg.length > 1))
}

// The first operand that would land outside the task root, or null. The root itself counts as outside,
// because deleting it deletes the task. An operand the policy can't resolve (`~`, `$VAR`) counts too.
function outsideRoot(words, root) {
  const operands = words.slice(1).filter((arg) => !arg.startsWith('-'))
  return operands.find((operand) => {
    if (operand.startsWith('~') || operand.includes('$') || operand.includes('`')) return true
    const path = relative(root, resolve(root, operand))
    return path === '' || path.startsWith('..') || isAbsolute(path)
  }) ?? null
}

/** The verdict for one `agents:before-permission` payload: `{ ok: true }`, or `{ ok: false, reason }`. */
export function decide(payload) {
  for (const words of simpleCommands(payload.command ?? '').map(program)) {
    if (isForcePush(words)) {
      return { ok: false, reason: 'Force-pushing rewrites shared history. Push without --force, or ask the person to.' }
    }
    // With no root to compare against, the rule can't tell inside from outside, so it stays quiet.
    const outside = payload.root && DESTRUCTIVE.has(words[0]) ? outsideRoot(words, payload.root) : null
    if (outside) return { ok: false, reason: `${words[0]} would remove ${outside}, outside this task's worktree.` }
  }
  return { ok: true }
}

const SHELLS = new Set(['sh', 'bash', 'zsh'])

/** A warning for a request the rules let through, or null. The person still decides. */
export function warn(payload) {
  const commands = simpleCommands(payload.command ?? '').map(program)
  for (const [index, words] of commands.entries()) {
    if (gitPushArgs(words)) return 'This pushes commits to a remote, where other people can see them.'
    if (DESTRUCTIVE.has(words[0]) && words.slice(1).some((arg) => /^-[a-zA-Z]*[rR]/.test(arg) || arg === '--recursive')) {
      return `${words[0]} deletes recursively. Check what it removes before you allow it.`
    }
    // `curl … | sh`: the split puts the shell in the next simple command.
    if ((words[0] === 'curl' || words[0] === 'wget') && SHELLS.has(commands[index + 1]?.[0])) {
      return 'This runs a downloaded script without saving it first.'
    }
  }
  return null
}

// A test file, by the names the common test runners pick up.
const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/
const SOURCE_FILE = /\.([cm]?[jt]sx?|py|go|rs|rb)$/

/**
 * The test-first guard for `agents:after-tool`: a note for an edit to a source file before the session
 * has edited any test, or `''`. Once per file per session. It remembers sessions in memory, so a Node
 * restart starts each session over, which only means one more note.
 */
export function createTestFirst() {
  const tested = new Set()
  const noted = new Set()
  // A fixed cap, oldest first, like the warnings. A long-lived Node forgets old sessions.
  const remember = (set, key) => { set.add(key); if (set.size > 500) set.delete(set.values().next().value) }
  return (payload) => {
    if (payload.kind !== 'edit' || !payload.succeeded) return ''
    if (payload.paths.some((path) => TEST_FILE.test(path))) {
      remember(tested, payload.sessionId)
      return ''
    }
    if (tested.has(payload.sessionId)) return ''
    const source = payload.paths.find((path) => SOURCE_FILE.test(path) && !noted.has(`${payload.sessionId}:${path}`))
    if (!source) return ''
    remember(noted, `${payload.sessionId}:${source}`)
    const name = payload.root ? relative(payload.root, source) : source
    return `Test first: you changed ${name} before any test in this session. Write a failing test that covers the change, then make it pass.`
  }
}
