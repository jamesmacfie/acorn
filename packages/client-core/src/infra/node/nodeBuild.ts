import { ACORN_BUILD, SOURCE_BUILD, type NodeInfo } from '@acorn/protocol/node.ts'
import { readJson } from './apiClient'
import { createFleetQuery, type FleetResult } from './fanout'

// Which build each node runs, for Settings → Nodes (docs/api-reference/versioning.md § Mixed builds).
// A fan-out like the attachments beside it: a node that can't answer leaves its row without a build
// line. The broker sends this device's token, which is what makes `GET /v1/node` include the build.

const NODE_BUILD_KEY = ['node-build'] as const

// `null` is a Node that doesn't report its build. Mixed-version path until 2027-01-13.
export const createNodeBuilds = () =>
  createFleetQuery<string | null>(
    () => NODE_BUILD_KEY,
    async (nodeId, _dep, signal) => (await readJson<NodeInfo>('/v1/node', { nodeId, signal })).buildVersion ?? null,
  )

export const buildOf = (result: FleetResult<string | null>, nodeId: string): string | null | undefined =>
  result.rows.find((row) => row.nodeId === nodeId)?.data

// How a node's row compares its build with this app's. A side run from source has no stamp, so a
// difference involving it is `unstamped`, a plain line rather than a warning. A Node that reports
// nothing is `different`. `undefined` until the node answers.
export const compareBuild = (
  nodeBuild: string | null | undefined,
  appBuild = ACORN_BUILD,
): 'same' | 'unstamped' | 'different' | undefined => {
  if (nodeBuild === undefined) return undefined
  if (nodeBuild === appBuild) return 'same'
  if (nodeBuild !== null && (nodeBuild === SOURCE_BUILD || appBuild === SOURCE_BUILD)) return 'unstamped'
  return 'different'
}

// How a row names a build. `null` is a Node from before builds were reported.
export const buildLabel = (build: string | null): string =>
  build === null ? 'an older build' : build === SOURCE_BUILD ? 'from source' : `build ${build}`
