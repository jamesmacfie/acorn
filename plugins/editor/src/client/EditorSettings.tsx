import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSettingSave, prefsOptions } from '@acorn/plugin-api/client'
import { Checkbox, Select, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'
import { readEditorIndentation, readEditorWordWrap, saveEditorIndentation, saveEditorWordWrap } from './editorPrefs'

export default function EditorSettings() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const wrapSave = createSettingSave()
  const indentationSave = createSettingSave()
  const indentation = () => readEditorIndentation(prefs.data)
  const indentationChoices = (['spaces', 'tabs'] as const).flatMap((mode) =>
    ([2, 4, 8] as const).map((width) => ({
      value: `${mode}:${width}`,
      label: `${mode === 'spaces' ? 'Spaces' : 'Tabs'}: ${width}`,
      indentation: { mode, width },
    })),
  )

  return (
    <SettingsSection id="defaults" label="Editing defaults">
      <SettingRow
        label="Word wrap"
        description="Wrap text in files without a per-file override."
        error={wrapSave.error()}
      >
        <Checkbox
          switch
          ariaLabel="Word wrap"
          checked={readEditorWordWrap(prefs.data)}
          onChange={(enabled) => wrapSave.run(() => saveEditorWordWrap(queryClient, enabled))}
        />
      </SettingRow>
      <SettingRow
        label="Indentation"
        description="Used when a file has no consistent indentation to detect."
        error={indentationSave.error()}
      >
        <Select
          label="Indentation"
          value={`${indentation().mode}:${indentation().width}`}
          options={indentationChoices}
          onChange={(value) => {
            const choice = indentationChoices.find((option) => option.value === value)
            if (choice) void indentationSave.run(() => saveEditorIndentation(queryClient, choice.indentation))
          }}
        />
      </SettingRow>
    </SettingsSection>
  )
}
