import { describe, expect, it } from 'vitest'
import { EXAMPLES } from './guide'
import { programProblems } from './validate'

const codes = (program: string, plans: string[] = []) =>
  programProblems(program, plans).problems.map((problem) => `${problem.code} ${problem.path}`)

describe('programProblems', () => {
  it("passes the guide's checklist", () => {
    expect(codes(EXAMPLES[0]!.split('\n').slice(1).join('\n'))).toEqual([])
  })

  it('passes a heading above a Panel of the app plan', () => {
    expect(codes('root = Stack([Heading("Open work"), Panel("open")])', ['open'])).toEqual([])
  })

  it('refuses a component the library lacks', () => {
    expect(codes('root = Stack([Chart("open")])')).toEqual([expect.stringMatching(/^unknown-component /)])
  })

  it('refuses a missing required prop', () => {
    expect(codes('root = Stack([Heading()])')).toContainEqual(expect.stringMatching(/^missing-required /))
  })

  it('refuses a Query or Panel that names a plan the app lacks, and a plan nothing reads', () => {
    expect(codes('rows = Query("missing", {}, {rows: []})\nroot = Stack([Text("x")])', ['spare'])).toEqual([
      'unknown-plan /program/rows',
      'unused-plan /plans/spare',
    ])
  })

  it('takes the task tool as a query and the row action as the only mutation', () => {
    expect(
      codes(
        'task = Query("task", {}, {})\nact = Mutation("rowAction", {plan: "open", row: "r", action: "a"})\nroot = Stack([Text(task.title), Panel("open")])',
        ['open'],
      ),
    ).toEqual([])
    expect(codes('act = Mutation("deleteEverything", {})\nroot = Stack([Text("x")])')).toEqual([
      'unknown-tool /program/act',
    ])
  })

  it('refuses a plan named by an expression', () => {
    expect(codes('name = "open"\nroot = Stack([Panel(name)])', ['open'])).toContainEqual('unknown-plan /program/root')
  })

  it('refuses a program that declares or sets $placement, and lets it read one', () => {
    expect(codes('$placement = "pane"\nroot = Stack([Text($placement)])')).toEqual(['reserved /program/$placement'])
    expect(codes('root = Stack([Button("Go", @Set($placement, "pane"))])')).toEqual(['reserved /program/root'])
    expect(codes('root = $placement == "card" ? Text("small") : Text("big")')).toEqual([])
  })

  it('points a program that is one Panel to panel_show', () => {
    const { problems } = programProblems('root = Panel("open")', ['open'])
    expect(problems).toEqual([
      expect.objectContaining({ code: 'single-panel', hint: 'Show the plan with panel_show instead.' }),
    ])
  })

  it('refuses a program over 64 KiB', () => {
    expect(codes(`root = Text("${'x'.repeat(64 * 1024)}")`)).toEqual(['too-large /program'])
  })

  it('evaluates against query defaults, with ticked rows as a list', () => {
    expect(
      codes(
        [
          'root = Stack(@Each(@GroupBy(rows.rows, "project"), "g", Card(g.key, [List(@Each(g.rows, "t", ListItem(t.title, null, [], [Checkbox("t", "Done", @Includes($ticked, t._id), null, @Set($ticked, @Toggled($ticked, t._id)))])))])))',
          '$ticked = []',
          'rows = Query("open", {}, {rows: [{_id: "1", title: "One", project: "api"}]})',
        ].join('\n'),
        ['open'],
      ),
    ).toEqual([])
  })
})
