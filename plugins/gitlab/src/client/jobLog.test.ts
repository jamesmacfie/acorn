import { expect, it } from 'vitest'
import { jobSections } from './jobLog'

it("splits a job log into its sections, drops colour, and gives the last one the job's status", () => {
  const log = [
    '\u001b[0KRunning with gitlab-runner 17.4',
    'section_start:1700000000:prepare_script\r\u001b[0K\u001b[36;1mPreparing environment\u001b[0;m',
    'Running on runner-1',
    'section_end:1700000001:prepare_script\r\u001b[0K',
    'section_start:1700000002:step_script[collapsed=true]\r\u001b[0KExecuting "step_script"',
    '$ npm test',
    '\u001b[31mFAIL\u001b[0m src/app.test.ts',
    'section_end:1700000003:step_script\r\u001b[0K',
  ].join('\n')
  expect(jobSections(log, 'failure')).toEqual([
    { id: 0, name: 'Job log', status: 'success', lines: ['Running with gitlab-runner 17.4'] },
    { id: 1, name: 'Preparing environment', status: 'success', lines: ['Running on runner-1'] },
    { id: 2, name: 'Executing "step_script"', status: 'failure', lines: ['$ npm test', 'FAIL src/app.test.ts'] },
  ])
  expect(jobSections('plain log\n', 'success')).toEqual([
    { id: 0, name: 'Job log', status: 'success', lines: ['plain log', ''] },
  ])
})
