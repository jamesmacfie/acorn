import { Spinner } from '../../kit/components/content/Spinner'

/** The desktop's region placeholder (`setRegionPlaceholder`): the kit spinner and the
 *  pane's name, centred in the region. The spinner carries the words for a screen reader. */
export function RegionLoading(props: { label: string }) {
  return (
    <div class="region-loading">
      <Spinner label={`Loading ${props.label}`} />
      <span aria-hidden="true">Loading {props.label}…</span>
    </div>
  )
}
