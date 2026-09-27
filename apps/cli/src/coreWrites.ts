import { isAbsolute } from 'node:path'
import type { Project, Task, Workspace } from '@acorn/protocol/api.ts'
import type { ParsedArgs } from './args'
import { CliError } from './error'
import { readJsonFile, rejectDoubleStdin, requestKey, requireOption, typedId, operationKey } from './input'
import type { CliNode } from './node'
import { projectResource, taskResource, workspaceResource } from './projection'

const apiVersion = 'acorn.cli/v1'
const pathFor = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

async function workspace(node: CliNode, id: string) {
  const rows = await node.get('/v1/core/workspaces') as Workspace[]
  const row = rows.find((item) => item.id === id)
  if (!row) throw new CliError('not_found', `No workspace has ID ${id}.`, 4)
  return workspaceResource(node.nodeId, row)
}

async function mutation<T>(node: CliNode, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, key: string): Promise<T> {
  return await node.mutate(method, path, body, key) as T
}

const configKeys = new Set(['setupScript', 'setupScriptTrigger', 'teardownScript', 'devScript', 'devRestartScript', 'dbUrlScript', 'dbSchemaMode', 'dbSchemaValue', 'dbSchemaNotes', 'previewMode', 'previewValue', 'browserRules', 'branchPrefix'])
const stringKeys = new Set(['setupScript', 'teardownScript', 'devScript', 'devRestartScript', 'dbUrlScript', 'dbSchemaValue', 'dbSchemaNotes', 'previewValue', 'branchPrefix'])
function configPatch(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !Object.keys(value).length) throw new CliError('invalid_input', 'Configuration patch must be a nonempty JSON object.', 2)
  for (const [key, input] of Object.entries(value)) {
    if (!configKeys.has(key)) throw new CliError('invalid_input', `Unknown configuration field ${key}.`, 2)
    if (stringKeys.has(key) && typeof input !== 'string') throw new CliError('invalid_input', `${key} must be a string.`, 2)
    if (key === 'setupScriptTrigger' && !['off', 'created', 'terminal'].includes(String(input))) throw new CliError('invalid_input', 'setupScriptTrigger must be off, created, or terminal.', 2)
    if (key === 'dbSchemaMode' && !['', 'auto', 'script', 'file'].includes(String(input))) throw new CliError('invalid_input', 'Invalid dbSchemaMode.', 2)
    if (key === 'previewMode' && !['', 'url', 'port', 'script'].includes(String(input))) throw new CliError('invalid_input', 'Invalid previewMode.', 2)
    if (key === 'dbSchemaNotes' && (input as string).length > 8000) throw new CliError('invalid_input', 'dbSchemaNotes exceeds 8000 characters.', 2)
    if (key === 'branchPrefix' && (input as string).length > 60) throw new CliError('invalid_input', 'branchPrefix exceeds 60 characters.', 2)
    if (key === 'browserRules') {
      if (!Array.isArray(input) || !input.every((rule) => isObject(rule) && Object.keys(rule).every((field) => ['id', 'enabled', 'urlPattern', 'trigger', 'action'].includes(field))
        && typeof rule.id === 'string' && typeof rule.enabled === 'boolean' && typeof rule.urlPattern === 'string' && rule.trigger === 'load'
        && isObject(rule.action) && Object.keys(rule.action).every((field) => ['type', 'selector', 'value'].includes(field))
        && rule.action.type === 'fill' && typeof rule.action.selector === 'string' && typeof rule.action.value === 'string')) {
        throw new CliError('invalid_input', 'browserRules must match the project configuration rule schema.', 2)
      }
    }
  }
  return value
}

function mappingBody(value: unknown): { projects: { integrationId: string; externalId: string; projectId?: string }[] } {
  if (!isObject(value) || Object.keys(value).some((key) => key !== 'projects') || !Array.isArray(value.projects)) {
    throw new CliError('invalid_input', 'External mapping file must contain a complete projects array.', 2)
  }
  for (const row of value.projects) {
    if (!isObject(row) || Object.keys(row).some((key) => !['integrationId', 'externalId', 'projectId'].includes(key))
      || typeof row.integrationId !== 'string' || !row.integrationId || typeof row.externalId !== 'string' || !row.externalId
      || (row.projectId !== undefined && (typeof row.projectId !== 'string' || !row.projectId))) {
      throw new CliError('invalid_input', 'Each mapping needs integrationId, externalId, and optional projectId.', 2)
    }
  }
  return value as { projects: { integrationId: string; externalId: string; projectId?: string }[] }
}

export async function runCoreWrite(node: CliNode, args: ParsedArgs): Promise<unknown> {
  const [subject, verb, rawId, subId] = args.positionals
  const o = args.options
  const key = requestKey(o['request-id'])
  if (subject === 'workspace') {
    if (verb === 'create') {
      const row = await mutation<Workspace>(node, 'POST', '/v1/core/workspaces', { name: requireOption(o, 'name') }, key)
      return workspaceResource(node.nodeId, row)
    }
    if (verb === 'external-projects') {
      const id = rawId === 'list' || rawId === 'replace' ? subId : undefined
      if (!id) throw new CliError('usage', 'workspace external-projects needs list|replace and an ID.', 2)
      await workspace(node, id)
      const path = pathFor('/v1/core/workspaces', id) + '/external-projects'
      if (rawId === 'replace') {
        const file = requireOption(o, 'file')
        const body = mappingBody(await readJsonFile(file))
        await mutation(node, 'PUT', path, body, key)
      }
      let response: { projects: unknown[] }
      try { response = await node.get(path) as { projects: unknown[] } }
      catch (error) {
        if (rawId === 'replace') throw new CliError('partial_mapping_replace', `Mappings for workspace ${id} were replaced, but the follow-up read failed. ${error instanceof Error ? error.message : String(error)}`, 7, key)
        throw error
      }
      return { apiVersion, kind: 'WorkspaceExternalProjects', nodeId: node.nodeId, id, projects: response.projects,
        ...(rawId === 'replace' ? { replacedCount: response.projects.length } : {}) }
    }
    const id = rawId
    if (!id) throw new CliError('usage', `workspace ${verb} needs an ID.`, 2)
    if (verb === 'rename') {
      await mutation(node, 'PATCH', pathFor('/v1/core/workspaces', id), { name: requireOption(o, 'name') }, key)
      try { return await workspace(node, id) }
      catch (error) { throw new CliError('partial_workspace_rename', `Workspace ${id} was renamed, but the follow-up read failed. ${error instanceof Error ? error.message : String(error)}`, 7, key) }
    }
    if (verb === 'remove') {
      await mutation(node, 'DELETE', pathFor('/v1/core/workspaces', id), undefined, key)
      return { apiVersion, kind: 'Deletion', nodeId: node.nodeId, id, resourceKind: 'Workspace' }
    }
  }
  if (subject === 'project') {
    if (verb === 'add') {
      rejectDoubleStdin([o.workspace])
      const workspaceId = await typedId(o.workspace, 'Workspace', node, 'workspace')
      const path = requireOption(o, 'path')
      if (!isAbsolute(path)) throw new CliError('usage', '--path must be absolute on the selected Node host.', 2)
      const response = await mutation<{ project: Project }>(node, 'POST', '/v1/core/projects', { path, workspaceId, ...(o.name ? { name: o.name } : {}) }, key)
      return projectResource(node.nodeId, response.project)
    }
    if (verb === 'config') {
      const action = rawId
      const id = subId
      if (!id || !['show', 'set'].includes(action ?? '')) throw new CliError('usage', 'project config needs show|set and an ID.', 2)
      const path = pathFor('/v1/core/projects', id) + '/config'
      if (action === 'set') {
        const patch = configPatch(await readJsonFile(requireOption(o, 'patch-file')))
        const result = await mutation<{ config: unknown }>(node, 'PUT', path, { patch }, key)
        return { apiVersion, kind: 'ProjectConfig', nodeId: node.nodeId, id, config: result.config }
      }
      const response = await node.get(path) as { config: unknown }
      return { apiVersion, kind: 'ProjectConfig', nodeId: node.nodeId, id, config: response.config }
    }
    if (!rawId) throw new CliError('usage', `project ${verb} needs an ID.`, 2)
    const path = pathFor('/v1/core/projects', rawId)
    if (verb === 'remove') {
      await mutation(node, 'DELETE', path, undefined, key)
      return { apiVersion, kind: 'Deletion', nodeId: node.nodeId, id: rawId, resourceKind: 'Project' }
    }
    if (verb === 'detect') {
      const response = await mutation<{ project: Project }>(node, 'POST', `${path}/detect`, {}, key)
      return projectResource(node.nodeId, response.project)
    }
    const patch = verb === 'rename' ? { name: requireOption(o, 'name') }
      : verb === 'move' ? { workspaceId: await typedId(o.workspace, 'Workspace', node, 'workspace') }
      : verb === 'hide' ? { hidden: true } : { hidden: false }
    const response = await mutation<{ project: Project }>(node, 'PATCH', path, patch, key)
    return projectResource(node.nodeId, response.project)
  }
  if (subject === 'task' && verb === 'create') {
    const projectId = await typedId(o.project, 'Project', node, 'project')
    const title = requireOption(o, 'title')
    const row = await mutation<Task>(node, 'POST', '/v1/core/tasks', {
      projectId, title, origin: 'local', ...(o.branch ? { branch: o.branch } : {}), skipSetup: o['skip-setup'] === 'true',
    }, operationKey(key, 'task-create'))
    const resource = taskResource(node.nodeId, row)
    try {
      await mutation(node, 'POST', pathFor('/v1/core/tasks', row.id) + '/on-created', {}, operationKey(key, 'task-on-created'))
    } catch (error) {
      throw new CliError('partial_task_create', `Task ${row.id} was created, but on-created setup did not complete. Retry with --request-id ${key} or inspect the task. ${error instanceof Error ? error.message : String(error)}`, 7, key, true, resource)
    }
    return resource
  }
  throw new CliError('usage', 'Unknown write command.', 2)
}
