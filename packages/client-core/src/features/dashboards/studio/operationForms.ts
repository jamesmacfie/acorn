import type { Component } from 'solid-js'
import ComputeForm from './ComputeForm'
import ExpandForm from './ExpandForm'
import FilterForm from './FilterForm'
import OverlapForm from './OverlapForm'
import SummarizeForm from './SummarizeForm'
import type { Stage, StageFormProps } from './stageFormParts'

/** The form for each step operation. The `satisfies` clause makes an operation without a form a type
 *  error, so a new operation can't ship without one (docs/dashboards/mapping-and-editor.md § The
 *  generated editor). */
export const operationForms = {
  filter: FilterForm,
  compute: ComputeForm,
  summarize: SummarizeForm,
  expand: ExpandForm,
  overlap: OverlapForm,
} satisfies { [Op in Stage['op']]: Component<StageFormProps<Op>> }
