# What the dashboards programme refuses

Status: proposed, 2026-10-02, revised the same day. Each entry says what was considered, why it is
out, and what would make it worth revisiting. Four entries carry over from the August 2026 record and
still hold. One, the refusal of joins, is replaced: its own revisit condition has been met. The earlier
text is in git history.

## Plugin-drawn panels and a widget toolkit on the wire

A panel is composed by the person over typed records, and the host draws every pixel of it with its
own views. A plugin never ships a panel component, and the wire never carries a widget vocabulary
that the host would have to support forever.

This is not the same question as the remote component tree, where plugin code emits closed-kit nodes
into a slot the owner opened. A slot's contents are chosen by the plugin. A panel's contents are
chosen by the person. When a plugin needs UI the field types can't express, the answer is a remote
tree in a pane the plugin owns, or a rectangle for pixels, never a panel type.

Revisit if a case appears where the person composes and the plugin draws, at the same time, in the
same rectangle.

## New field types without a fight

Every field type is drawn for every provider forever. This programme adds none. Currency, percent,
duration, and size are units on the number type. Calendar dates are a precision on the datetime type.
Lists are a cardinality on any type. Tones and ranks are properties of declared choices.

Revisit when a real panel needs a value that no combination of type, unit, precision, and list can
express, and treat the addition as a protocol version event.

## Dashboard machinery reachable from frames

Panel plans, placements, runs, identity answers, actions, and datasets are host-owned. They are never
stored in a frame's preference namespace, never writable through the bridge, and never rendered inside
a frame document. A frame that could edit a plan could point the host's chrome at routes of its
choosing.

Revisit never. Widen the placement constraint vocabulary instead.

## A per-plugin dashboard contribution

A plugin does not ship a prebuilt dashboard surface that it owns. It can suggest starter plans,
which the person accepts into their own panels, and from then on the person owns them. That keeps
every panel the person's own composition and keeps the plugin a provider of records.

Revisit if starter plans prove unable to carry what plugins want to offer.

## Undeclared joins, fuzzy matching, and silent multiplication

The August record refused cross-source joins, with the revisit condition "if union and mapping
demonstrably fail" and the note that a declared relation should come before a general join. The 30
examples meet that condition: release checklists, mirrored issues, invoice matching, branch-to-pull
request lookups, and budget lookups all need records from two sources in one row. Workstream 5
therefore adds declared relations and a row model that says which source supplies the rows.

What stays refused is everything around them. There is no join on a key the author or the source
hasn't declared, and no key that leaves out the scope that makes it unique. There is no matching on
titles, labels, or names. There is no relation that can multiply rows without saying so: cardinality is
declared and checked on every run, and a violation fails visibly. A relation never merges rows. Only an
equivalence, a declared "same item in another system", does. And there is no relation that reads
another plugin's storage instead of its source.

Revisit the general join only if declared relations fail a class of real panels.

## Branching pipelines inside a panel

Stages form one bounded, linear list. A panel can't split its rows into two independently processed
branches and join them back. Conditional measures cover most of what a branch would do, such as overall
run counts beside counts for a filtered subset, and relations cover combining sources. A branch is also
where a plan stops being describable in a short list of sentences.

Revisit if real panels keep needing two differently filtered views of the same rows that conditional
measures can't express.

## A formula language or SQL inside panels

An open expression language makes plans uncheckable, gives the AI a way to produce plausible nonsense,
and turns the editor into a text box. Workstream 5's compute stage offers a closed set of expressions,
each with a form, a description, a validator, and evaluation cases, and repeated stages give that set
room to work. Logic beyond it runs in a workflow or an agent that writes a dataset, where it is
visible, testable, and scheduled.

Revisit if the closed expression set keeps growing toward a language anyway, which would mean the
dataset path isn't serving people.

## Host fan-out across repositories or projects

The host could run one query per repository and combine the results. It would multiply reads on every
refresh, hit provider rate limits, and leave sorting and completeness across hundreds of reads
unsolved. Sources accept lists of repositories or projects, or search the account's whole reach, and
read them the way their provider does best. Raising the eight-query limit is refused for the same
reason.

Revisit if an important provider has no way to read several scopes at once, and then add fan-out
inside that provider's adapter, not in the host.

## Provider meaning in the panel engine

The engine does not decide whether a pull request is ready to merge, whether a ticket is about to
breach, or how a recurring meeting expands. Those depend on provider rules that the engine can't see
and would get subtly wrong. Adapters compute them and expose the result, including "unknown". The
engine does own comparisons across sources, such as overlapping meetings from two calendar providers,
because no adapter can see across that boundary.

Revisit never. Ask the adapter for a better field instead.

## The AI deciding between accounts

When a person has two Linear accounts, only the person knows which one a panel is about. The AI may
propose which sources can answer a request, and it may use a person's only account for a source,
naming it in the plan. When there is more than one, it asks with the person's real accounts as choices.

Revisit if account names become unambiguous by construction, such as one account per provider per
workspace.

## Silent partial results

A valid panel that answers half the request is worse than an error, because it looks finished. The
AI's requirements list, the host's check of it, the independent requirements pass, and the
host-written description exist so that a partial result always says what it leaves out. The run carries
incomplete reads, uncovered windows, and dataset gaps forward, and history never stores a measure from
an incomplete read.

Revisit never.

## Grading the AI by its own checklist

The requirements list is written by the same model that wrote the plan, so it can't reveal what the
model missed. Evaluation compares plans against requirements and expected results that people
annotated, and acceptance adds requests nobody has seen.

Revisit never.

## A second execution path on the client

The client renders runs and keeps a cache. It doesn't fetch sources and project them itself, because
two implementations of one plan will disagree, and the sampler's answer has to mean what the screen
says.

Revisit if a view needs instant local reshaping, such as clicking a column header, and then keep that
as view state over a finished run, not as a second execution of the plan.

## Classifying messages or other content inside a panel

Deciding whether a message is a direct question needs a model's judgement, evidence, and a way to
correct mistakes. A panel can't hold any of that. A workflow or agent writes a dataset with the
evidence and a correction field, and the panel reads it.

Revisit never for panels. The dataset path carries this.

## Panels across several Nodes

A panel runs on the active Node. Combining Nodes needs identity, credentials, and freshness across
machines, which belongs to the cloud programme.

Revisit with [cloud](../cloud/README.md) team Nodes.
