import { createEffect, createSignal, on, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams, useSearchParams } from '@solidjs/router'
import { branchesOptions, compareOptions, mentionsOptions } from './queries'
import { projectsOptions } from '@acorn/plugin-api/client'
import { pullsKey, type Branch } from '../contract/api'
import { Alert, Button, Checkbox, EmptyState, Input, MentionTextarea, Picker } from '@acorn/plugin-api/ui'
import { createPr } from './mutations'
import { clearPullDraft, prefillFromCompare, readPullDraft, writePullDraft } from './createPull/model'
import { githubBrowsePath } from './routes'
import './styles/pull-list.css'
import './styles/pull-detail.css'

// Mid (Navigator) pane in create mode: base/head pickers + title/body/draft + Create. base/head
// live in the URL (?base=&head=) so they're shareable and reactive — the compare query and the
// right-pane preview both read them. Title/body prefill from the compare until the user edits.
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

  // Prefill title/body from the compare once it lands, until the user types in either field.
  createEffect(() => {
    const data = compare.data
    if (!data || touched()) return
    const filled = prefillFromCompare(data.commits, head())
    setTitle(filled.title)
    setBody(filled.body)
  })

  // Restore this repo's stored draft (created after the prefill effect so it wins over a prefill that
  // resolves from cache on the first tick), then keep writing it back as the user edits. Deps are
  // explicit via `on` — the body must not subscribe to the fields it assigns.
  createEffect(
    on(
      () => `${o()}/${r()}`,
      () => {
        const d = readPullDraft(o(), r())
        setTitle(d?.title ?? '')
        setBody(d?.body ?? '')
        setDraft(d?.draft ?? false)
        setTouched(d?.touched ?? false)
        // The URL wins when it carries a comparison already (back-navigation, a shared link).
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

  // Substring filter over the loaded branches; the shared Picker owns the popover + filter input.
  const branchResults = (query: string) => {
    const q = query.trim().toLowerCase()
    const list = branches.data ?? []
    return q ? list.filter((b) => b.name.toLowerCase().includes(q)) : list
  }

  return (
    <Show when={repoKnown()} fallback={<EmptyState align="start" busy>Loading…</EmptyState>}>
      <div class="create-pr">
        <div class="create-pr-branches">
          <Picker<Branch>
            label={base() || 'base'}
            placeholder="Filter branches…"
            emptyText="No matching branches."
            results={branchResults}
            rowLabel={(b) => b.name}
            isActive={(b) => b.name === base()}
            onSelect={(b) => setSearchParams({ base: b.name })}
          />
          <span class="branch-arrow">←</span>
          <Picker<Branch>
            label={head() || 'Choose a branch…'}
            placeholder="Filter branches…"
            emptyText="No matching branches."
            results={branchResults}
            rowLabel={(b) => b.name}
            isActive={(b) => b.name === head()}
            onSelect={(b) => setSearchParams({ head: b.name })}
          />
        </div>

        {/* Was `.pr-filter` — the PR title is not a filter, so it is a plain Input. */}
        <Input
          class="create-pr-title"
          placeholder="Title"
          value={title()}
          onInput={(e) => {
            setTouched(true)
            setTitle(e.currentTarget.value)
          }}
        />
        <MentionTextarea
          class="composer-input create-pr-body"
          placeholder="Describe this pull request… (⌘↵ to create)"
          value={body()}
          onInput={(v) => { setTouched(true); setBody(v) }}
          onKeyDown={onBodyKey}
          mentions={mentionsList()}
        />

        <label class="create-pr-draft">
          <Checkbox checked={draft()} onChange={(e) => setDraft(e.currentTarget.checked)} />
          Create as draft
        </label>

        <div class="pr-actions">
          <Button onClick={submit} disabled={!canCreate()}>
            {create.isPending ? 'Creating…' : draft() ? 'Create draft pull request' : 'Create pull request'}
          </Button>
        </div>

        <Show when={comparable()} fallback={<div class="create-pr-status">Choose a branch to open a pull request.</div>}>
          <Show when={!compare.isLoading} fallback={<div class="create-pr-status">Comparing…</div>}>
            <div class="create-pr-status">
              {aheadBy() > 0 ? `${aheadBy()} commit${aheadBy() === 1 ? '' : 's'} · ${compare.data?.files.length ?? 0} files` : 'Nothing to compare — branches are identical.'}
            </div>
          </Show>
        </Show>

        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
      </div>
    </Show>
  )
}
