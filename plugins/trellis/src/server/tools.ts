import { z } from 'zod'
import type { AgentToolContribution } from '@acorn/plugin-api/node'
import { appCreateInput, appPatchInput, appReadInput, appShowInput, appWriteInput } from '../shared/api'
import type { AppToolDeps } from './handlers'

// The seven app tools (docs/agent-tools.md § Apps). Only these declarations are on the Node's boot
// path; what they do loads, with lang-core, on the first call (./handlers.ts).

const handlers = () => import('./handlers')

export const appTools = (deps: AppToolDeps): AgentToolContribution[] => [
  {
    name: 'app_guide',
    description:
      'How to build an app: the component library and language, the plan instructions, and worked examples. Read it before your first app. For one view of one plan, use panel_show instead.',
    input: z.strictObject({}),
    scope: 'task',
    risk: 'read',
    handler: async (_input, ctx) => (await handlers()).guideApps(deps, ctx),
  },
  {
    name: 'app_create',
    description: "Create an app in this task with an empty program. Returns its id and the program's hash.",
    input: appCreateInput,
    scope: 'task',
    risk: 'write',
    handler: async (input, ctx) => (await handlers()).createApp(deps, input, ctx),
  },
  {
    name: 'app_read',
    description:
      "Read one of an app's working files, `program` or `plans/<name>`, with its hash. Without a file, lists them.",
    input: appReadInput,
    scope: 'task',
    risk: 'read',
    handler: async (input, ctx) => (await handlers()).readApp(deps, input, ctx),
  },
  {
    name: 'app_write',
    description:
      "Replace one of an app's working files, or delete a plan with content null. Pass the hash you read when the file exists.",
    input: appWriteInput,
    scope: 'task',
    risk: 'write',
    handler: async (input, ctx) => (await handlers()).writeApp(deps, input, ctx),
  },
  {
    name: 'app_patch',
    description:
      "Merge statements into an app's program by name: a statement replaces the one with its name, a new name adds one, and `name = null` deletes one. Pass the program's hash.",
    input: appPatchInput,
    scope: 'task',
    risk: 'write',
    handler: async (input, ctx) => (await handlers()).patchApp(deps, input, ctx),
  },
  {
    name: 'app_show',
    description:
      'Check the working program and plans, publish them as the next revision with a one-line note, and draw it as a card. A failure lists every problem and draws nothing.',
    input: appShowInput,
    scope: 'task',
    risk: 'write',
    handler: async (input, ctx) => (await handlers()).showApp(deps, input, ctx),
  },
  {
    name: 'app_list',
    description: "List this task's apps with their ids and head revisions.",
    input: z.strictObject({}),
    scope: 'task',
    risk: 'read',
    handler: async (_input, ctx) => (await handlers()).listApps(deps, ctx),
  },
]
