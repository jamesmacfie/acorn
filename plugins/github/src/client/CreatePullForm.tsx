import { createEffect, createSignal, on, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams, useSearchParams } from '@solidjs/router'
import { branchesOptions, compareOptions, mentionsOptions } from './queries'
import { projectsOptions } from '@acorn/plugin-api/client'
import { pullsKey, type Branch } from '../shared/api'
import { Alert, Button, Checkbox, EmptyState, Field, Inline, Input, MentionTextarea, Picker, Stack, Text, Toolbar } from '@acorn/plugin-api/ui'
import { createPr } from './mutations'
import { clearPullDraft, prefillFromCompare, readPullDraft, writePullDraft } from './createPull/model'
import { githubBrowsePath } from './clientRoutes'

// The navigator column in create mode: base and head pickers, title, body, draft and Create. base and
// head live in the URL (?base=&head=) so they're shareable and reactive, and the compare query and the
// preview column both read them. Title and body prefill from the compare until the user edits.
export default function CreatePullForm() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((x) => x.id === params.projectId)
  const github = () => project()?.github
  const o = () => github()?.owner ?? ''
  const r = () => github()?.name ?? ''
  const repoKnown = () => !!project()?.id && !!github()
  const branches = createQuery(() => branchesOptions(o(), r(), repoKnown()))
  const mentionsQuery = createQuery(() => mentionsOptions(o(), r(), repoKnown()))
  const mentionsList = () => mentionsQuery.data ?? []

  const base = () => (typeof searchParams.base === 'string' && searchParams.base) || project()?.defaultBranch || ''
  const head = () => (typeof searchParams.head === 'string' ? searchParams.head : '')
  const comparable = () => !!head() && head() !== base()
  const compare = createQuery(() => compareOptions(o(), r(), base(), head(), repoKnown() && comparable()))

  const [title, setTitle] = createSignal('')
  const [body, setBody] = createSignal('')
  const [draft, setDraft] = createSignal(false)
  const [touched, setTouched] = createSignal(false)
  const [error, setError] = createSignal('')

  // Prefill title and body from the compare once it lands, until the user types in either field.
  createEffect(() => {
    const data = compare.data
    if (!data || touched()) return
    const filled = prefillFromCompare(data.commits, head())
    setTitle(filled.title)
    setBody(filled.body)
  })

  // Restore this repo's stored draft, created after the prefill effect so it wins over a prefill that
  // resolves from cache on the first tick, then keep writing it back as the user edits. Deps are
  // explicit via `on`, because the body must not subscribe to the fields it assigns.
  createEffect(
    on(
      () => `${o()}/${r()}`,
      () => {
        const d = readPullDraft(o(), r())
        setTitle(d?.title ?? '')
        setBody(d?.body ?? '')
        setDraft(d?.draft ?? false)
        setTouched(d?.touched ?? false)
        // The URL wins when it carries a comparison already: back-navigation, or a shared link.
        if (d && !searchParams.base && !searchParams.head && (d.base || d.head))
          setSearchParams({ base: d.base || undefined, head: d.head || undefined }, { replace: true })
      },
    ),
  )
  createEffect(() => {
    writePullDraft(o(), r(), { base: base(), head: head(), title: title(), body: body(), draft: draft(), touched: touched() })
  })

  const create = createMutation(() => ({
    mutationFn: () => createPr(o(), r(), { title: title().trim(), body: body(), base: base(), head: head(), draft: draft() }),
  }))
  const aheadBy = () => compare.data?.aheadBy ?? 0
  const canCreate = () => comparable() && !!title().trim() && aheadBy() > 0 && !create.isPending

  const submit = () => {
    if (!canCreate()) return
    setError('')
    create
      .mutateAsync()
      .then((res) => {
        clearPullDraft(o(), r())
        qc.invalidateQueries({ queryKey: pullsKey(o(), r(), 'open') })
    navigate(`${githubBrowsePath(params.projectId ?? '')}/${res.number}`)
      })
      .catch((e) => setError(String(e.message ?? e)))
  }
  const onBodyKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  // Substring filter over the loaded branches; the shared Picker owns the popover and filter input.
  const branchResults = (query: string) => {
    const q = query.trim().toLowerCase()
    const list = branches.data ?? []
    return q ? list.filter((b) => b.name.toLowerCase().includes(q)) : list
  }

  return (
    <Show when={repoKnown()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
      <Stack gap="section">
        <Field label="Branches" hint="The pull request compares head into base.">
          <Inline>
            <Picker<Branch>
              label={base() || 'base'}
              placeholder="Filter branches…"
              emptyText="No matching branches."
              results={branchResults}
              rowLabel={(branch) => branch.name}
              isActive={(branch) => branch.name === base()}
              onSelect={(branch) => setSearchParams({ base: branch.name })}
            />
            <Text emphasis="muted">←</Text>
            <Picker<Branch>
              label={head() || 'Choose a branch…'}
              placeholder="Filter branches…"
              emptyText="No matching branches."
              results={branchResults}
              rowLabel={(branch) => branch.name}
              isActive={(branch) => branch.name === head()}
              onSelect={(branch) => setSearchParams({ head: branch.name })}
            />
          </Inline>
        </Field>

        <Field label="Title">
          <Input
            placeholder="Title"
            value={title()}
            onInput={(value) => {
              setTouched(true)
              setTitle(value)
            }}
          />
        </Field>
        <Field label="Description">
          <MentionTextarea
            placeholder="Describe this pull request… (⌘↵ to create)"
            value={body()}
            onInput={(value) => { setTouched(true); setBody(value) }}
            onKeyDown={onBodyKey}
            mentions={mentionsList()}
          />
        </Field>

        <Checkbox label="Create as draft" checked={draft()} onChange={(checked) => setDraft(checked)} />

        <Toolbar variant="actions">
          <Button tone="accent" onPress={submit} disabled={!canCreate()}>
            {create.isPending ? 'Creating…' : draft() ? 'Create draft pull request' : 'Create pull request'}
          </Button>
        </Toolbar>

        <Show when={comparable()} fallback={<Text emphasis="muted">Choose a branch to open a pull request.</Text>}>
          <Show when={!compare.isLoading} fallback={<Text emphasis="muted">Comparing…</Text>}>
            <Text emphasis="muted">
              {aheadBy() > 0
                ? `${aheadBy()} commit${aheadBy() === 1 ? '' : 's'} · ${compare.data?.files.length ?? 0} files`
                : 'Nothing to compare — branches are identical.'}
            </Text>
          </Show>
        </Show>

        <Show when={error()}>{(text) => <Alert>{text()}</Alert>}</Show>
      </Stack>
    </Show>
  )
}
