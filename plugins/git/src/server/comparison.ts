import { BridgeError, type CoreServices } from '@acorn/plugin-api/node'
import type { Comparison, ComparisonMode } from '../shared/api'
import { commitById } from './history'
import { refRoster } from './refs'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'>
const ID = /^[0-9a-f]{40,64}$/

export async function pinComparison(core: Core, projectId: string, source: string, destination: string, mode: ComparisonMode): Promise<Comparison> {
  const roster = await refRoster(core, projectId)
  const pin = async (selection: string) => {
    const id = ID.test(selection) ? selection : roster.refs.find((ref) => `${ref.kind}:${ref.name}` === selection)?.commitId
    if (!id) throw new BridgeError(400, 'bad_ref', 'Select a commit or a ref that points to a commit.')
    await commitById(core, roster.repository, id)
    return id
  }
  const [sourceId, destinationId] = await Promise.all([pin(source), pin(destination)])
  if (sourceId === destinationId) throw new BridgeError(400, 'same_commit', 'Choose two different commits to compare.')
  let base = sourceId
  if (mode === 'merge-base') {
    const merged = await core.git.git(['merge-base', sourceId, destinationId], { cwd: roster.repository, maxOutputBytes: 128 })
    if (merged.code !== 0 || !ID.test(merged.stdout.trim())) throw new BridgeError(422, 'no_merge_base', 'These commits have no shared ancestor.')
    base = merged.stdout.trim()
  }
  return { source: sourceId, destination: destinationId, base, mode }
}
