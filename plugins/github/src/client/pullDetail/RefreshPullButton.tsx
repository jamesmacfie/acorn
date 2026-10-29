import { createSignal } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { IconButton } from '@acorn/plugin-api/ui'
import { fileSummariesKey, pullDiffKey, pullKey, pullsPrefixKey } from '../../shared/api'
import { forceRefreshPull } from '../queries'

// The pull and its files again from GitHub, and every ticket anything linked off them. The browse
// surface and the PR pane both offer it, because the Node's copy only refreshes on its own when
// something announces a change.
export function RefreshPullButton(props: { owner: string; repo: string; number: string }) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = createSignal(false)

  async function refresh() {
    const { owner, repo, number } = props
    setRefreshing(true)
    try {
      const { detail, diff } = await forceRefreshPull(owner, repo, number)
      queryClient.setQueryData(pullKey(owner, repo, number), detail)
      queryClient.setQueryData(pullDiffKey(owner, repo, number), diff)
      await Promise.all([
        // The file list reads summaries of the mirror that refresh just rewrote.
        queryClient.invalidateQueries({ queryKey: fileSummariesKey(owner, repo, number) }),
        queryClient.invalidateQueries({ queryKey: pullsPrefixKey(owner, repo) }),
        // Linked tickets, both list enrichment and any open detail, refetch too. Keyed by string
        // rather than by importing the plugin that supplies them, so a force-refresh of a pull does
        // not make this plugin depend on whichever providers enrich it. The host's one prefix covers
        // every provider.
        queryClient.invalidateQueries({ queryKey: ['plugin-ref-resolutions'] }),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <IconButton
      icon="refresh-cw"
      tip="Refresh pull request"
      label="Refresh pull request"
      busy={refreshing()}
      onPress={() => void refresh()}
    />
  )
}
