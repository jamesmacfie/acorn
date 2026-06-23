import { createMemo, createResource, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useParams, useSearchParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import gitdiffParser from 'gitdiff-parser'
import { filesOptions } from './queries'
import { getHighlighter, langFor } from './shiki'

// Right (Diff) pane: parse the selected file's unified-diff patch, syntax-highlight (Shiki, dual
// theme via CSS vars), virtualize rows (docs/git-diff.md, docs/ui-style.md §6).

type Tok = { content: string; light: string; dark: string }
type Row =
  | { kind: 'hunk'; text: string }
  | { kind: 'normal' | 'insert' | 'delete'; oldNo: number | null; newNo: number | null; toks: Tok[] }

// GitHub's per-file `patch` is hunks-only; synthesize a header so gitdiff-parser keys on it.
const synth = (path: string, patch: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`

export default function DiffView() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const files = createQuery(() => filesOptions(params.owner ?? '', params.repo ?? '', params.number ?? '', !!params.number))
  const selected = createMemo(() => files.data?.find((f) => f.path === searchParams.file) ?? null)

  // Parse + highlight off the render path; re-runs when the selected file changes.
  const [rows] = createResource(
    () => selected(),
    async (file): Promise<Row[]> => {
      if (!file?.patch) return []
      const parsed = gitdiffParser.parse(synth(file.path, file.patch))
      const hunks = parsed[0]?.hunks ?? []
      const hl = await getHighlighter()
      const lang = langFor(file.path)
      const tok = (content: string): Tok[] => {
        if (lang === 'text') return [{ content, light: '', dark: '' }] // no grammar → render plain
        const [line] = hl.codeToTokensWithThemes(content, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })
        return (line ?? []).map((t) => ({ content: t.content, light: t.variants.light.color ?? '', dark: t.variants.dark.color ?? '' }))
      }
      const out: Row[] = []
      for (const h of hunks) {
        out.push({ kind: 'hunk', text: h.content || `@@ -${h.oldStart} +${h.newStart} @@` })
        for (const ch of h.changes) {
          if (ch.type === 'normal') out.push({ kind: 'normal', oldNo: ch.oldLineNumber, newNo: ch.newLineNumber, toks: tok(ch.content) })
          else if (ch.type === 'insert') out.push({ kind: 'insert', oldNo: null, newNo: ch.lineNumber, toks: tok(ch.content) })
          else out.push({ kind: 'delete', oldNo: ch.lineNumber, newNo: null, toks: tok(ch.content) })
        }
      }
      return out
    },
  )

  let scrollEl: HTMLDivElement | undefined
  const virt = createVirtualizer({
    get count() {
      return rows()?.length ?? 0
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 20,
    overscan: 20,
  })

  return (
    <Show when={searchParams.file} fallback={<p class="placeholder">Select a file.</p>}>
      <Show when={selected()?.patch} fallback={<p class="placeholder">{rows.loading ? 'Loading…' : 'No diff (binary or too large).'}</p>}>
        <div class="diff" ref={scrollEl}>
          <div class="diff-rows" style={{ height: `${virt.getTotalSize()}px` }}>
            <For each={virt.getVirtualItems()}>
              {(vi) => {
                const row = () => rows()![vi.index]
                return (
                  <div
                    class="diff-row"
                    classList={{
                      'diff-hunk': row().kind === 'hunk',
                      'diff-add': row().kind === 'insert',
                      'diff-del': row().kind === 'delete',
                    }}
                    style={{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                  >
                    <Show
                      when={row().kind !== 'hunk'}
                      fallback={<span class="diff-hunk-text">{(row() as { text: string }).text}</span>}
                    >
                      {(() => {
                        const r = row() as Extract<Row, { kind: 'normal' | 'insert' | 'delete' }>
                        return (
                          <>
                            <span class="diff-gutter">{r.oldNo ?? ''}</span>
                            <span class="diff-gutter">{r.newNo ?? ''}</span>
                            <span class="diff-marker">{r.kind === 'insert' ? '+' : r.kind === 'delete' ? '−' : ' '}</span>
                            <span class="diff-code">
                              <For each={r.toks}>
                                {(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}
                              </For>
                            </span>
                          </>
                        )
                      })()}
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  )
}
