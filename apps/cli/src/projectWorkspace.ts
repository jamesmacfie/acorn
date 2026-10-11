import type { Project } from '@acorn/protocol/api.ts'
import { CliError } from './error'
import { typedId } from './input'
import type { CliNode } from './node'

export async function workspaceForProject(node: CliNode, project: string): Promise<string> {
  const id = await typedId(project, 'Project', node, 'project')
  const row = (await node.get(`/v1/core/projects/${encodeURIComponent(id)}`)) as Project
  if (!row || typeof row.workspaceId !== 'string')
    throw new CliError('invalid_response', 'The Node returned an invalid project.', 1)
  return row.workspaceId
}
