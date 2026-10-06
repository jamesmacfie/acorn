# AI authoring

This page covers generating and editing a workflow with a model, and how the Node checks what the model
returns. The code is in `plugins/workflows/src/server/authoring/`.

## Generating and editing with AI

**AI authoring** opens a bounded conversation in a dialog over the workflow draft. Closing the dialog
keeps the conversation on the device, and opening it again picks up the same thread. Each turn can request
allowlisted source metadata, dynamic source discovery, option IDs, or compatible child workflows;
ask an inline clarification; or return a proposal. API-backed model connections and text-only agent
harnesses use the same JSON response protocol over the existing `generateText` service.

The conversation (`AuthoringConversation`) can also draw docked beside what it edits, as the panel
studio's does. Workflows still opens it in a dialog, because docking it needs a step-by-step diff of
the workflow to review proposals on.

The conversation stores pending context, clarifications, and proposals in device-local recovery
state keyed by Node and workflow. Source records stay out of the prompt unless the user enables
**Use preview records to help AI**. An enabled sample contains at most three selected records and
16 KiB. Responses that fail the authoring protocol are repaired with the exact invalid field
and validation limit. After three rejected responses, the error includes the final validation
problems so the failure can be diagnosed. Cancellation keeps the draft unchanged, and each result reports model request and token use.

A proposal shows a semantic diff before it can change the draft. Applying it reconciles a stale
base against the current definition by stable step ID, refuses conflicts, and runs the workflow
validator again. One accepted proposal creates one undo entry. Rejecting it changes nothing. The
conversation cannot save, publish, run, activate, change a provider, or read credentials.

For each sources use `items: { step: "predecessor-id", pointer: "/issues" }`. Both authoring
paths teach this shape even when no saved child workflows are available. If the model writes a
plain typed step binding instead, the response parser converts it to this source shape before
validation, preserving the referenced step ID and pointer. It leaves fallback values, conversions,
other binding sources, and malformed addresses for validation and repair. The proposal diff shows
the canonical definition that applying the edit uses.

### Legacy one-shot endpoint

The device-only `/defs/generate` route remains for compatibility with callers of the earlier
one-shot generation contract. The workflow editor uses `/defs/authoring/turn` for interactive AI
editing.

The edit projection removes provider choices, configured execution targets, tool allowlists,
triggers, and the `headers` and `auth` fields of contributed step configuration from each step. The
scoped catalog separately lists the child targets that the model may use on a new step. After the
answer is grounded, the server restores protected values onto each surviving step with the same name
and kind. Deleting, renaming, or changing the kind of a step deliberately breaks that identity and
does not carry its protected configuration onto the replacement.

What the model is told about acorn is assembled at request time, not written down. The step kinds
with the fields each one describes, the policies and the agent profiles all come out of the same
catalog `GET /v1/p/workflows/catalog` answers, so a plugin that contributes a step kind makes it
available to the model with no prompt to edit here. That list is also the list the answer is checked
against: a kind in the catalog but missing from the prompt would be one the model can never use and
nothing would ever strip. The workspace's own definitions ride along as worked examples, ranked so
that one with a step waiting on two others comes first, because a fan-in is the thing a model gets
wrong on its own. The definition being edited is left out of its own examples, and so is any
definition that does not itself pass the checker: a workspace's broken workflow is the wrong thing to
learn house style from.

`plugins/workflows/src/server/authoring/generate.ts` is the prompt API. Its private `generate/`
modules own the fixed teaching text, catalog rendering, example selection, and prompt assembly.
`generationRequest.ts` makes the model calls, and `ground.ts` checks the reply against the same
forbidden-key list used by kind rendering. A prompt digest test pins the complete system, edit, and
repair text because whitespace and section order affect model behavior and provider cache keys.

Generation also receives the selected project's bounded child workflow catalog. It contains the
same references, input signatures, and output schemas that the child workflow picker uses. Grounding
removes a reference outside that catalog, an input binding the target does not declare, and a source
that is not a structured predecessor. An empty catalog forbids saved-child targets but permits For each with an inline item agent.
No saved workflow is needed for that target. Model and reasoning choices remain editor settings
in the compatibility generator, including nested item-agent configuration.

The server does not silently restore a changed child target. Both the conversation and compatibility
route keep only references in the scoped child catalog, and the conversation exposes a target change
in the semantic diff for review.

The reply is read back rather than trusted. Anything named in it that this node does not have is
taken out before the draft is touched. An invented step kind becomes a plain agent step keeping its
prompt, rather than a deleted step, because deleting one cascades through every `after` and `branches`
target that names it. An invented policy loses its value and stays a policy gate, because
retargeting it to a human gate would silently turn a hard check into a no-op under an autonomous
posture. A generated gate form that would not load is dropped and the gate is kept, never the other
way round, so a bad answer still stops for a person. An unknown `with` key goes, while the step's stable ID keeps every reference intact when its
display name changes. Each grounding change is reported in a dismissible alert above the node list,
because a list of things that were changed is not something to read in a toast. What the definition
still gets wrong is not repeated there: the footer already draws it.

There is one repair pass and never two. When the first answer passes the checker, which is the common
case, that is the only model call. When it does not, the checker's own messages go back once,
verbatim, along with the definition as it stands after the stripping, and the second answer is taken
if it parses and has at least one step. It is never chosen on having fewer problems, because the
cheapest way for a model to shorten a problem list is to delete the steps carrying the problems. The
answer is applied either way. A definition with problems in the footer is every workflow partway
through being built, and **Run** is what refuses to start one. The alert above the node list
describes the answer that was applied and only that one. When the repair is the one kept, a note
about the first draft would be about a definition nobody ever sees.

The AI authoring button is not drawn when the owner has nothing to generate with, meaning no
model provider connected and no agent CLI installed either
([integrations.md](../integrations.md) § Model providers), on the rule the commit-message wand
follows: a control whose only message is "connect one first" is a control in the way of the ones
beside it, and Settings, under AI models, is where a key is added. Repository file drafts
use the same conversation and keep their separate review-before-publication flow.

One submitted instruction can make at most eight metadata requests and three candidate attempts. The
client uses an 11-minute broker timeout for the bounded sequence and exposes **Cancel** while it runs
([api-reference.md](../api-reference.md) § Transport).
