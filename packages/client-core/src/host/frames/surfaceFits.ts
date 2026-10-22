import { formFactor } from '../../infra/platform'

/** Whether a frame surface says it works on this device. The manifest spells `narrow` as `mobile`. */
export const surfaceFitsDevice = (surface: { formFactor: readonly ('desktop' | 'mobile')[] }): boolean =>
  surface.formFactor.includes(formFactor() === 'narrow' ? 'mobile' : 'desktop')
