/** The shared semantic tone for an agent tool status, on the desktop and in the browser extension. Any
 *  status this doesn't name, such as one a newer harness reports, is muted. */
export const agentToolTone = (status: string | null | undefined): 'ok' | 'danger' | 'muted' | 'accent' => {
  if (status === 'running') return 'accent'
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'danger'
  return 'muted'
}
