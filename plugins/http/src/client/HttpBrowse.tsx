// The API rail Source. Source components take no props (App.tsx renders them via <Dynamic> with
// nothing passed), so the repo comes from the route — the same way RollbarBrowse scopes itself.
// With no repo routed yet, offer the picker rather than a dead end.
import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { Show } from 'solid-js'
import { projectsOptions } from '@acorn/client-core/queries.ts'
import HttpPanel from './HttpPanel'
import './http.css'

export default function HttpBrowse() {
  const params = useParams()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId && !candidate.hidden)

  return (
    <Show
      when={project()}
      keyed
      fallback={
        <div class="http-choose-repo">
          <h2>API</h2>
          <p class="http-hint">Select a project from the project menu to browse its saved requests.</p>
        </div>
      }
    >
      {(selected) => <HttpPanel projectId={selected.id} projectName={selected.name} />}
    </Show>
  )
}
