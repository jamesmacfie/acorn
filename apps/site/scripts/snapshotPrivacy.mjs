// What real data looks like in a shell snapshot (docs/site.md § Shell snapshots). The fixture is
// invented throughout, so a snapshot that matches any of these caught something from the machine that
// captured it. Fix the fixture or the capture, never the rule.

// 127.0.0.1 is localhost by number: a paired Node on the same computer shows its endpoint that way.
const HOSTS = ['example.com', 'localhost', '127.0.0.1', 'github.com', 'getacorn.dev']

const allowedHost = (host) => HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))

// A run long enough to be a secret, and mixed enough not to be a word or a path.
const looksRandom = (run) => /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run)

/** Each way `text` looks like it holds real data, as a sentence naming what matched. */
export function privacyProblems(text) {
  const problems = []
  for (const [match] of text.matchAll(/(?:\/Users|\/home)\/[^\s"'<>/]+/g)) problems.push(`a home folder path: ${match}`)
  for (const [match, domain] of text.matchAll(/\b[\w.+-]+@((?:[\w-]+\.)+[a-z]{2,})\b/gi)) {
    if (domain.toLowerCase() !== 'example.com') problems.push(`an email address outside example.com: ${match}`)
  }
  for (const [match] of text.matchAll(/\b(?:gh[pousr]_|github_pat_)\w{10,}/g)) problems.push(`a GitHub token: ${match}`)
  for (const [match] of text.matchAll(/\bBearer\s+[\w.~+/-]{8,}/gi)) problems.push(`a bearer header: ${match}`)
  for (const [match] of text.matchAll(/\b[0-9a-f]{32,}\b/gi)) problems.push(`a long hex run: ${match}`)
  for (const [match] of text.matchAll(/[A-Za-z0-9+/_-]{40,}={0,2}/g)) {
    if (looksRandom(match)) problems.push(`a long base64 run: ${match}`)
  }
  for (const [, host] of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^/\s"'<>:?#]+)/gi)) {
    if (!allowedHost(host.toLowerCase())) problems.push(`a hostname outside ${HOSTS.join(', ')}: ${host}`)
  }
  return problems
}
