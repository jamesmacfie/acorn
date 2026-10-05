import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import ts from 'typescript'
import { PLUGIN_API_MAJOR } from '../../packages/protocol/src/plugin/apiVersion.ts'

// Loaded packages import the two published npm packages below. The private @acorn/plugin-api
// snapshot is independent; pruning an in-repo helper does not change this contract. Member names
// expose removals; the SDK and types contract tests compare the published shapes with host types.
const ROOT = join(import.meta.dirname, '../..')
const SNAPSHOT = join(import.meta.dirname, 'publishedPluginSurface.snapshot.txt')
const HEADER = (major: string) => `# loaded plugin API major: ${major}`

type Surface = { names: string[]; values: string[] }

function surface(entry: string, file: string): Surface {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const names: string[] = []
  const values: string[] = []

  const add = (kind: 'type' | 'value', name: string) => {
    names.push(`${entry}: ${kind} ${name}`)
    if (kind === 'value') values.push(name)
  }

  const members = (type: ts.TypeNode | undefined, owner: string, containingSource = source): void => {
    if (!type) return
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      for (const part of type.types) members(part, owner, containingSource)
    } else if (ts.isParenthesizedTypeNode(type)) {
      members(type.type, owner, containingSource)
    } else if (ts.isTypeLiteralNode(type)) {
      for (const member of type.members) {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue
        const path = `${owner}.${member.name.getText(containingSource)}`
        names.push(`${entry}: member ${path}`)
        if (ts.isPropertySignature(member)) members(member.type, path, containingSource)
      }
    }
  }

  const reexportedMembers = (from: ts.ExportDeclaration, name: string): void => {
    if (!from.moduleSpecifier || !ts.isStringLiteral(from.moduleSpecifier) || !from.moduleSpecifier.text.startsWith('.')) return
    const target = join(dirname(file), from.moduleSpecifier.text.replace(/\.js$/, '.ts'))
    const targetSource = ts.createSourceFile(target, readFileSync(join(ROOT, target), 'utf8'), ts.ScriptTarget.Latest, true)
    const declaration = targetSource.statements.find((statement): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === name)
    if (!declaration) throw new Error(`${file} reexports ${name} without a matching local declaration`)
    if (ts.isTypeAliasDeclaration(declaration)) members(declaration.type, name, targetSource)
    else for (const member of declaration.members) {
      if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue
      const path = `${name}.${member.name.getText(targetSource)}`
      names.push(`${entry}: member ${path}`)
      if (ts.isPropertySignature(member)) members(member.type, path, targetSource)
    }
  }

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        throw new Error(`${file} has an export form the surface scanner does not cover`)
      }
      for (const specifier of statement.exportClause.elements) {
        add(statement.isTypeOnly || specifier.isTypeOnly ? 'type' : 'value', specifier.name.text)
        if (statement.isTypeOnly || specifier.isTypeOnly) reexportedMembers(statement, specifier.propertyName?.text ?? specifier.name.text)
      }
      continue
    }

    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      add('type', statement.name.text)
      if (ts.isTypeAliasDeclaration(statement)) members(statement.type, statement.name.text)
      else for (const member of statement.members) {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue
        const path = `${statement.name.text}.${member.name.getText(source)}`
        names.push(`${entry}: member ${path}`)
        if (ts.isPropertySignature(member)) members(member.type, path)
      }
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (!statement.name) throw new Error(`${file} has an unnamed export`)
      add('value', statement.name.text)
      if (ts.isClassDeclaration(statement)) for (const member of statement.members) {
        if (!ts.isPropertyDeclaration(member) && !ts.isMethodDeclaration(member)) continue
        if (!member.name) continue
        names.push(`${entry}: member ${statement.name.text}.${member.name.getText(source)}`)
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw new Error(`${file} has a destructured export`)
        add('value', declaration.name.text)
      }
    } else {
      throw new Error(`${file} has an export form the surface scanner does not cover`)
    }
  }
  return { names, values }
}

function publishedSurface(): string[] {
  const sdkExports = JSON.parse(readFileSync(join(ROOT, 'packages/plugin-sdk/package.json'), 'utf8')) as { exports: Record<string, unknown> }
  const typesExports = JSON.parse(readFileSync(join(ROOT, 'packages/plugin-types/package.json'), 'utf8')) as { exports: Record<string, unknown> }
  expect(Object.keys(sdkExports.exports).sort()).toEqual(['.', './data', './remote', './testing'])
  expect(Object.keys(typesExports.exports)).toEqual(['.'])

  const sdk = surface('acorn-plugin-sdk', 'packages/plugin-sdk/src/index.ts')
  const sdkTypes = surface('acorn-plugin-sdk', 'packages/plugin-sdk/src/public.ts')
  const remote = surface('acorn-plugin-sdk/remote', 'packages/plugin-sdk/src/remote/solid.ts')
  const remoteTypes = surface('acorn-plugin-sdk/remote', 'packages/plugin-sdk/src/remote/public.ts')
  const data = surface('acorn-plugin-sdk/data', 'packages/plugin-sdk/src/data/index.ts')
  const dataTypes = surface('acorn-plugin-sdk/data', 'packages/plugin-sdk/src/data/public.ts')
  const testing = surface('acorn-plugin-sdk/testing', 'packages/plugin-sdk/src/testing/index.ts')
  const testingTypes = surface('acorn-plugin-sdk/testing', 'packages/plugin-sdk/src/testing/public.ts')
  const nodeTypes = surface('acorn-plugin-types', 'packages/plugin-types/src/public.ts')

  // A declaration-only omission would strand a TypeScript consumer even when the runtime still exports
  // the name. The inverse would advertise a value the bundle cannot provide.
  expect(new Set(sdk.values)).toEqual(new Set(sdkTypes.values))
  expect(new Set(remote.values)).toEqual(new Set(remoteTypes.values))
  expect(new Set(data.values)).toEqual(new Set(dataTypes.values))
  expect(new Set(testing.values)).toEqual(new Set(testingTypes.values))
  expect(sdkTypes.names).toContain('acorn-plugin-sdk: member AcornBridge.api.get')
  expect(nodeTypes.names).toContain('acorn-plugin-types: member NodePluginContext.routes')

  const names = [...sdk.names, ...sdkTypes.names, ...remote.names, ...remoteTypes.names,
    ...data.names, ...dataTypes.names, ...testing.names, ...testingTypes.names, ...nodeTypes.names]
  expect(names.length).toBeGreaterThan(300)
  return [...new Set(names)].sort()
}

function readSnapshot(): { major: string; names: string[] } {
  const [header, ...names] = readFileSync(SNAPSHOT, 'utf8').trimEnd().split('\n')
  const major = /^# loaded plugin API major: (\d+)$/.exec(header)?.[1]
  if (!major) throw new Error(`${SNAPSHOT} must start with "# loaded plugin API major: <n>"`)
  return { major, names }
}

it('pins published plugin names and declared members to the loaded-plugin major', () => {
  const actual = publishedSurface()
  const committed = readSnapshot()

  if (process.env.UPDATE_PUBLISHED_PLUGIN_SURFACE) {
    const removed = committed.names.filter((name) => !actual.includes(name))
    if (removed.length && committed.major === PLUGIN_API_MAJOR) {
      throw new Error(`Removing published plugin names or declared members under API major ${PLUGIN_API_MAJOR} requires a major bump or restoring them:\n${removed.join('\n')}`)
    }
    writeFileSync(SNAPSHOT, [HEADER(PLUGIN_API_MAJOR), ...actual].join('\n') + '\n')
  }

  expect(readSnapshot()).toEqual({ major: PLUGIN_API_MAJOR, names: actual })
})
