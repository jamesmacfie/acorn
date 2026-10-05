# Derived sources

A derived source is a data source whose rows your own code builds from sources acorn already reads.
This page walks through one, from the scaffold to a panel, using `acorn-plugin-sdk/data` and
`acorn-plugin-sdk/testing`. It's part of [plugin authoring](../plugin-authoring.md). The host's rules
for inputs, bindings, approval, and completeness are in
[derived sources](../data-sources/derived-sources.md).

The example is a "Release readiness" source. It reads the Linear issues for a project, finds the
GitHub pull request for each one by branch name, and marks each issue **Ready**, **At risk**, or
**Blocked** by the team's rules.

## Create the package

Run the scaffold with `--data-source`:

```sh
npm create acorn-plugin release-readiness -- --data-source
```

It asks what one row represents, which sources the plugin reads, and which of those are optional. It
lists the built-in and first-party sources by number. You can also type another plugin's source as
`<pluginId>:<sourceId>`. For this example, answer `Issue`, then pick Linear issues and GitHub pull
requests.

```text
release-readiness/
  acorn-plugin.json      the manifest, with the data source and its inputs
  package.json           vite and vitest, and the SDK
  src/source.ts          the source: inputs, fields, and the logic
  src/source.test.ts     one passing test that uses fixtures
  src/index.ts           the node entry, which serves the source
  scripts/manifest.mjs   rewrites the manifest's source entry on each build
```

Run `npm install`, then `npm test`. The starter returns one row per issue.

## Write the source

`defineDerivedSource` takes the source's names, its inputs, its fields, and a `query` function. It
returns `{ definition, description, fetch }`. `src/index.ts` serves `fetch` on the plugin's namespace,
which is where the manifest's `handler` points.

```ts
import { defineDerivedSource, field, type InputRecord } from 'acorn-plugin-sdk/data'

// The team's rules. A choice field's value is one of its ids, so the return type names them.
function readinessOf(pull: InputRecord | undefined): 'ready' | 'at-risk' | 'blocked' {
  if (!pull || pull.data.checks === 'FAILURE') return 'blocked'
  if (!pull.data.draft && pull.data.checks === 'SUCCESS' && pull.data.reviewDecision === 'APPROVED') return 'ready'
  return 'at-risk'
}

export const source = defineDerivedSource({
  id: 'release-readiness',
  name: 'Release readiness',
  singular: 'Issue',
  plural: 'Issues',
  handler: '/v1/p/release-readiness/source',
  inputs: {
    issues: { source: 'linear:issues', label: 'Issues' },
    pulls: { source: 'github:pull-requests', label: 'Pull requests' },
  },
  fields: {
    title: field.text({ label: 'Issue', role: 'title' }),
    readiness: field.choice({ label: 'Readiness', role: 'status', choices: [
      { id: 'ready', label: 'Ready', tone: 'ok', rank: 0 },
      { id: 'at-risk', label: 'At risk', tone: 'warn', rank: 1 },
      { id: 'blocked', label: 'Blocked', tone: 'bad', rank: 2 },
    ] }),
    pull: field.number({ label: 'Pull request', nullable: true }),
  },
  async query({ inputs }) {
    const issues = await inputs.issues.all()
    const pulls = await inputs.pulls.all({ where: { state: 'open' } })
    return issues.records.map((issue) => {
      const key = String(issue.data.identifier).toLowerCase()
      const pull = pulls.records.find((record) => String(record.data.headBranch).includes(key))
      return {
        id: issue.ref.recordId,
        opens: (pull ?? issue).ref,
        data: {
          title: String(issue.data.title),
          readiness: readinessOf(pull),
          pull: pull ? Number(pull.data.number) : null,
        },
      }
    })
  },
})
```

Each input in `inputs` is a read-only handle. Acorn runs every read with the account the person picked
for that input on the panel, and the plugin never sees a credential:

- `all(query)` reads every page, until the input runs out or reaches 5,000 records. A read cut short
  marks this source's page incomplete.
- `query(query)` reads one page. Pass the cursor from a `more` completeness for the next one.
- `where` is a plain object of equality tests, such as `{ state: 'open' }`. The input source must
  support `eq` on that field. To filter on anything else, filter the records in your code.
- `describe()` and `identity()` return the input's description and the account's identity.

`opens` is an input record's `ref`. Pressing the row opens that record, using its own link or task.
Every record's `id` must be unique and stable, because panels and the record's details find it by id.

### Fields

Each field builder writes the field's label and display and its JSON schema together, so the two
can't disagree. The record type follows from the fields, so a record with a missing or misspelled field
is a compile error.

| Builder | Value |
| --- | --- |
| `field.text`, `field.person`, `field.link` | Text |
| `field.number` | A number, with an optional `unit` |
| `field.boolean` | `true` or `false` |
| `field.datetime` | Milliseconds since the epoch. `precision: 'day'` shows a date |
| `field.choice` | One of `choices`, each with an `id`, `label`, and optional `tone` and `rank` |

Every builder takes `label`, `description`, and `role` (`title`, `status`, `assignee`, `url`, or
`updated`). `list: true` makes the value a list. `nullable: true` lets a row have no value. A source
can also declare `parameters` with the same builders, and `query` receives their values.

### Optional inputs

Mark an input `optional: true` when the source still works without it. When the person skips it, its
handle is `undefined`, and the type says so, so `inputs.pulls.all()` doesn't compile until you write
`inputs.pulls?.all()` and decide what a row looks like without it.

## Test it

`acorn-plugin-sdk/testing` runs `query` against fake inputs, with the same record checks the app
applies:

```ts
import { expect, it } from 'vitest'
import { fixtures, testDerivedSource } from 'acorn-plugin-sdk/testing'
import { source } from './source'

it('marks an issue ready when its pull request is approved and green', async () => {
  const result = await testDerivedSource(source, {
    issues: fixtures('linear:issues', [{ identifier: 'ENG-1', title: 'Fix login' }]),
    pulls: fixtures('github:pull-requests', [
      { number: 7, headBranch: 'jm/eng-1-login', state: 'open', checks: 'SUCCESS', reviewDecision: 'APPROVED' },
    ]),
  })
  expect(result.rows).toMatchObject([{ data: { readiness: 'ready', pull: 7 } }])
  expect(result.dropped).toEqual([])
})
```

`fixtures('<pluginId>:<sourceId>', records)` builds input records from that source's real field list,
which the SDK ships for every built-in and first-party source. Fields you leave out get a typed
default: null where the field allows it, otherwise the first choice, an empty string, zero, `false`,
or an empty list. A link field gets an `https://example.test/...` address, so `opens` works in tests.
A field the source doesn't have throws, with a guess:

```text
GitHub pull requests have no field `head_branch`. Did you mean `headBranch`?
```

`testDerivedSource` returns `rows`, `dropped`, and `completeness`. A row that fails its declared
fields lands in `dropped` with the reason, and `completeness` counts it as `invalid-records`, which is
what a panel shows. A fake input applies `where` itself and refuses a field the real source can't
filter on. It returns records in the order you gave them.

The testing module runs under any test runner. For another plugin's source, which has no field list
in the SDK, pass records as `{ ref, data }` objects.

## Build and install

`npm run build` bundles `src/index.ts` and the SDK into `dist/node.js`, because an installed plugin has
no `node_modules`. It then runs the package's `manifest.mjs` script, which writes the manifest's
`contributions.dataSources` entry from `derivedSourceManifest(source)`. That keeps the inputs the owner
approves equal to the inputs the code reads.

1. Install the folder from **Settings › Plugins › Install… › Local folder**
   ([install a hand-written package](./installing-a-hand-written-package.md)).
2. Approve what it reads. The approval dialog lists each input under **Reads your data**. The plugin
   reads nothing until you approve.
3. Add a panel, pick **Release readiness**, and choose an account for each input.

An agent can do the writing. **Settings › Plugins › Create a plugin › Build a data source from your
connections** asks the two questions and drafts a prompt for the open task's agent that names the
template, the inputs, and the testing helpers.

## What the SDK answers for you

- `describe`, from the fields and parameters. The revision is a hash of both, and the host composes it
  with each input's revision.
- `query`, by running your logic once and paging the result to the host. A page's records are checked
  against the fields with the host's own validator. A record that fails is dropped and counted.
- `details`, from the newest run with the same scope, by id. A request bound to other accounts gets
  `not-found` rather than another account's row.
- Only a device or the Node's own service may call the route, as the host does. A task-confined agent
  credential that reaches it directly gets `403`.
- `actions` is always empty, and `identity` is unsupported. A derived source can't write through its
  inputs.

Two records with the same `id` fail the query, in tests and in the app.
