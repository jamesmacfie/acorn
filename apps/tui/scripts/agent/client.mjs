export async function requestSession(manifest, command, args = {}) {
  const response = await fetch(`${manifest.endpoint}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${manifest.secret}` },
    body: JSON.stringify({ command, ...args }),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `TUI driver returned ${response.status}.`)
  return result
}
