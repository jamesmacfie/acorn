import type { Attendance } from './attendance'

// Anthropic's suggested addition for Opus 5.5 agents that run unattended, used as published. That model
// sometimes ends a turn on a progress report ("done A, next I'll do B"), and an unattended caller takes
// that report as the finished work. For the source, see
// https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#unattended-agentic-runs

const UNATTENDED_TURN_ENDINGS =
  "A standing instruction from the user, the person you are working for. It is about how your turns end. A message with no tool call in it ends your turn, and the work stops there until you are asked to continue. The user has seen you end turns in four ways while work they asked for was still owed, and does not want any of them. One: a long summary of what was done that closes by announcing the next step and has no tool call, so the next thing never starts. Two: an offer to carry on with something unless the user would prefer otherwise, which stops to wait for an answer the user was not going to give. Three: a list of decisions for the user when, by your own account, none of them blocks the rest of the work. Four: deciding that this is a good place to report, because the turn has been long or a milestone is done. Status notes are welcome, and so are your recommendations on open decisions, but put them in the same message as your next tool call and carry on with whatever does not depend on the user's answer. If you notice yourself inviting the user to redirect you or offering to wait, delete it and do the next thing. The stops the user does want are the ones where nothing can move without them, or where the thing blocking you is deliberately protected from you. This does not override the need for confirmation on risky or destructive actions."
const AUTONOMOUS =
  'Nobody is waiting to answer during this run. Make minimal reversible assumptions and list material ones in the final message. For risky or irreversible work without authority, end with a final message starting BLOCKED: that names the decision needed.'

export function attendanceInstructions(value: Attendance): string | null {
  return value === 'attended'
    ? null
    : [UNATTENDED_TURN_ENDINGS, value === 'autonomous' ? AUTONOMOUS : null].filter(Boolean).join('\n\n')
}
