import { generateSystemPrompt } from '@openuidev/lang-core'
import { appLibrary, LIBRARY_ID, LIBRARY_VERSION, ROW_ACTION_TOOL, TASK_TOOL } from '../shared/library'

// What `app_guide` returns. The language half is generated from the running library, so it can't
// drift from what app_show accepts; the plan half is the panel guide every plan writer reads.

const STEPS = [
  'Use an app only for what one panel cannot do: state such as ticks, a form, buttons per row, inputs the person picks, or several views on one screen. One view of one plan is a panel: use panel_guide and panel_show.',
  'app_create, then write each plan with app_write at plans/<name> and the program with app_write at program. Change a program with app_patch, which merges statements by name; `name = null` deletes one. Every write after the first needs the hash the last read or write returned.',
  'app_show checks the program and plans and draws the next revision as a card. A failure lists every problem with its code, path, and hint, and draws nothing. Fix them and call app_show again. Give a one-line note saying what changed.',
  'The files live with the app, not in the task folder. Never write them with your own file tools.',
]

const RULES = [
  'Each of the app\'s plans is a Query by its own name: Query("myPlan", {}, {rows: []}) returns { rows } with one object per row: its columns by id, plus _id. Panel("myPlan") draws it with the dashboard\'s own view. Name plans with a string literal.',
  'A plan narrows by a value the person picks through an input address, { from: "input", name: "taskId", pointer: "" }, in a filter. Pass it as Query("myPlan", {taskId: $picked}, …) or Panel("myPlan", {taskId: $picked}). Every input a plan reads must be passed.',
  'Plans decide which records to read, and group and summarize them. @Filter, @Sort, and @GroupBy are for narrowing or arranging rows already read.',
  `Query("${TASK_TOOL}", {}, {}) returns the task the app is drawn in: { id, title, branch }.`,
  `A row's actions are listed on it as _actions: [{ id, label, risk }]. Run one with Mutation("${ROW_ACTION_TOOL}", {plan: "myPlan", row: $row, action: $action}) and @Run, after @Set($row, r._id) and @Set($action, "close"). The person confirms it first.`,
  '@ToAssistant(text) puts text in the composer for the person to send; it never sends. @OpenUrl(url) opens only http and https links, after the person confirms the URL.',
  '$placement is "card" in a conversation. Read it to draw a compact version; never declare or set it.',
  "$ variables last while the card is open. They aren't saved, so ticks and typed values are gone after a reload. Don't tell the person they're kept.",
  'A chart or table is always a Panel. There is no other.',
]

const EXAMPLES = [
  `A checklist:
root = Card("Release steps", [Checkbox("lint", "pnpm lint passes", $lint), Checkbox("tests", "pnpm test passes", $tests), progress])
$lint = false
$tests = false
progress = Text(@Count(@Filter([$lint, $tests], "", "==", true)) + " of 2 done", "muted")`,
  `Rows grouped by a field, each with a tick for its row and a button that asks the agent:
root = Stack([Heading("Open work"), groups])
$ticked = []
tasks = Query("openTasks", {}, {rows: []})
groups = Stack(@Each(@GroupBy(tasks.rows, "project"), "g", Card(g.key, [List(@Each(g.rows, "t", ListItem(t.title, t.branch, [], [Checkbox("t", "Done", @Includes($ticked, t._id), null, @Set($ticked, @Toggled($ticked, t._id))), Button("Ask", @ToAssistant("What is left on " + t.title + "?"), "ghost")])), "Nothing open.")])))`,
  `A picker that drives a plan's input, with two cards side by side:
root = Stack([Select("task", "Task", @Each(tasks.rows, "t", SelectItem(t._id, t.title)), $picked), Stack([Card("Cost", [Panel("taskCost", {taskId: $picked})]), Card("Notes", [Text("Pick a task to see its cost.", "muted")])], "row")])
$picked = ""
tasks = Query("activeTasks", {}, {rows: []})`,
]

export function appGuide(plans: unknown) {
  const library = appLibrary()
  return {
    library: { id: LIBRARY_ID, version: LIBRARY_VERSION },
    steps: STEPS,
    language: generateSystemPrompt({
      library: library.toSpec(),
      promptOptions: {
        toolCalls: true,
        bindings: true,
        tools: [
          {
            name: TASK_TOOL,
            description: 'The task the app is drawn in. Read only.',
            inputSchema: { type: 'object', properties: {} },
            outputSchema: { type: 'object', properties: { id: {}, title: {}, branch: {} } },
            annotations: { readOnlyHint: true },
          },
          {
            name: ROW_ACTION_TOOL,
            description: "Runs one of a plan row's actions, after the person confirms it.",
            inputSchema: {
              type: 'object',
              properties: { plan: { type: 'string' }, row: { type: 'string' }, action: { type: 'string' } },
              required: ['plan', 'row', 'action'],
            },
            outputSchema: { type: 'object', properties: { outcome: { type: 'string' } } },
          },
        ],
        additionalRules: RULES,
        examples: EXAMPLES,
        toolExamples: EXAMPLES,
      },
    }),
    plans,
  }
}
