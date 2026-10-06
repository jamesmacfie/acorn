import { isAbsolute, relative, resolve } from 'node:path'

// Two hard-coded rules over the command line a harness asked permission to run. These are examples,
// not containment: a command the harness doesn't ask about, or a script that does the same thing,
// never reaches them. README.md lists the forms they recognise.

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

function isForcePush(words) {
  if (words[0] !== 'git') return false
  // Skip git's own options, and the values `-C` and `-c` take.
  let index = 1
  while (index < words.length && words[index].startsWith('-')) index += words[index] === '-C' || words[index] === '-c' ? 2 : 1
  if (words[index] !== 'push') return false
  return words.slice(index + 1).some((arg) =>
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
