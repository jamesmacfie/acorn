import type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'
import { workspaceWords } from '../workspaces/words'
import {
  SETTINGS_CATEGORY_LABELS, type SettingsCategory, type SettingsContribution,
} from '../../host/registries/shell/settings'

/** Present a Settings declaration for one Node without changing its stable ids or the registry. */
export function settingsPageForMode(page: SettingsContribution, mode: WorkspacesMode | undefined): SettingsContribution {
  if (mode !== 'off') return page
  if (page.id === 'workspaces') {
    return { ...page, keywords: page.keywords?.filter((word) => word !== 'new workspace' && word !== 'move project') }
  }
  if (page.id === 'project.detail') {
    return { ...page, sections: page.sections?.map((section) => section.id === 'general'
      ? { ...section, rows: section.rows?.filter((row) => row !== 'Workspace') }
      : section) }
  }
  if (page.id === 'shortcuts') {
    return { ...page, sections: page.sections?.map((section) => section.id === 'global'
      ? { ...section, rows: section.rows?.map((row) => row === 'Switch to the last workspace' ? 'Switch to the last project' : row) }
      : section) }
  }
  return page
}

export function settingsCategoryLabel(category: SettingsCategory, mode: WorkspacesMode | undefined): string {
  return category === 'workspaces' && mode === 'off'
    ? workspaceWords(mode).capitalizedPlural : SETTINGS_CATEGORY_LABELS[category]
}
