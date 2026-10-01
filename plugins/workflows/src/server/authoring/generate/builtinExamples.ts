import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { WorkflowDef } from '../../../shared/workflowContracts'

// --- 8. two worked examples that always ship ---
//
// Data rather than text, so a test can put them through `validateWorkflow` and a built-in example
// can never teach something the checker refuses. The first is the motivating case: parallel work,
// a fan-in, and a person approving before anything leaves the machine.

export const BUILTIN_EXAMPLES: readonly { def: WorkflowDef; note: string }[] = [
  {
    note: [
      '`reproduce` and `read-the-code` are both roots, so they run at the same time. `diagnose` waits',
      'for both and reads their answers with no references at all, because `inputs` defaults to',
      '`append`. Nothing leaves the machine until a person presses approve.',
    ].join(' '),
    def: {
      baseline: ACORN_BASELINE,
      formatVersion: 1,
      name: 'Investigate an issue from two angles',
      posture: 'gated',
      tools: { maxRisk: 'execute' },
      inputs: [{ name: 'issue', schema: { type: 'string' }, description: 'The issue to investigate', required: true }],
      steps: [
        {
          id: 'reproduce',
          name: 'reproduce',
          after: [],
          prompt: 'Reproduce this issue. Answer with the exact command that shows it and what it prints, or say you could not reproduce it and what you tried.\n\nIssue: ${inputs.issue}',
        },
        {
          id: 'read-the-code',
          name: 'read-the-code',
          after: [],
          prompt: 'Find the code behind this issue without running anything. Answer with the files and functions involved, one line each, and what you think is going wrong.\n\nIssue: ${inputs.issue}',
        },
        {
          id: 'diagnose',
          name: 'diagnose',
          after: ['reproduce', 'read-the-code'],
          prompt: 'A reproduction attempt and a code reading of the same issue follow. Write the diagnosis: what is broken, why, and the smallest change that would fix it.',
        },
        {
          id: 'write-the-fix',
          name: 'write-the-fix',
          after: ['diagnose'],
          prompt: 'Make the change the diagnosis describes and run the tests that cover it. Commit nothing and push nothing.',
        },
        { id: 'approve', name: 'approve', kind: 'gate-human', after: ['write-the-fix'] },
        {
          id: 'open-a-pull-request',
          name: 'open-a-pull-request',
          after: ['approve'],
          prompt: 'Commit the change, push the branch, and open a pull request. The title says what changed and the body says why.',
        },
      ],
    },
  },
  {
    note: 'A structured plan can return zero items. Select a published child workflow, then add For each using /items and the stable /id key. Do not infer identity from array position.',
    def: {
      baseline: ACORN_BASELINE,
      formatVersion: 1,
      name: 'Plan package updates',
      steps: [{
        id: 'plan', name: 'Plan package updates', kind: 'agent',
        prompt: 'List packages needing an update. Return items with a stable id and title; return an empty array when none need updates.',
        schema: { type: 'object', required: ['items'], properties: {
          items: { type: 'array', items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } },
        } },
      }],
    },
  },
]

export const SECTION_EXAMPLES = [
  '## 8. Worked examples',
  '',
  ...BUILTIN_EXAMPLES.flatMap(({ def, note }) => [JSON.stringify(def, null, 2), '', note, '']),
].join('\n').trimEnd()
