import { createEffect, createSignal, Show } from 'solid-js'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams, useSearchParams } from '@solidjs/router'
import { branchesOptions, compareOptions, pullsKey, reposOptions, type Branch } from './queries'
import { createPr } from './mutations'
import { prefillFromCompare } from './features/createPull/model'
import Picker from './Picker'

// Mid (Navigator) pane in create mode: base/head pickers + title/body/draft + Create. base/head
// live in the URL (?base=&head=) so they're shareable and reactive — the compare query and the
// right-pane preview both read them. Title/body prefill from the compare until the user edits.
export default function CreatePullForm() {
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const o = () => params.owner ?? ''
  const r = () => params.repo ?? ''
  const repos = createQuery(() => reposOptions(true))
  const repo = () => repos.data?.find((x) => x.owner === o() && x.name === r())
  const repoKnown = () => !!repo()
  const branches = createQuery(() => branchesOptions(o(), r(), repoKnown()))

  const base = () => (typeof searchParams.base === 'string' && searchParams.base) || repo()?.defaultBranch || ''
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
        qc.invalidateQueries({ queryKey: pullsKey(o(), r(), 'open') })
        navigate(`/${o()}/${r()}/${res.number}`)
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
    <Show when={repoKnown()} fallback={<p class="placeholder">Loading…</p>}>
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

        <input
          class="pr-filter create-pr-title"
          placeholder="Title"
          value={title()}
          onInput={(e) => {
            setTouched(true)
            setTitle(e.currentTarget.value)
          }}
        />
        <textarea
          class="composer-input create-pr-body"
          placeholder="Describe this pull request… (⌘↵ to create)"
          value={body()}
          onInput={(e) => {
            setTouched(true)
            setBody(e.currentTarget.value)
          }}
          onKeyDown={onBodyKey}
        />

        <label class="create-pr-draft">
          <input type="checkbox" checked={draft()} onChange={(e) => setDraft(e.currentTarget.checked)} />
          Create as draft
        </label>

        <div class="pr-actions">
          <button type="button" onClick={submit} disabled={!canCreate()}>
            {create.isPending ? 'Creating…' : draft() ? 'Create draft pull request' : 'Create pull request'}
          </button>
        </div>

        <Show when={comparable()} fallback={<div class="create-pr-status">Choose a branch to open a pull request.</div>}>
          <Show when={!compare.isLoading} fallback={<div class="create-pr-status">Comparing…</div>}>
            <div class="create-pr-status">
              {aheadBy() > 0 ? `${aheadBy()} commit${aheadBy() === 1 ? '' : 's'} · ${compare.data?.files.length ?? 0} files` : 'Nothing to compare — branches are identical.'}
            </div>
          </Show>
        </Show>

        <Show when={error()}>
          <div class="action-error">{error()}</div>
        </Show>
      </div>
    </Show>
  )
}
