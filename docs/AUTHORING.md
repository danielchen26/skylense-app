# Authoring: demo-level maps for any repository

`skylense analyze` derives structure for any source: files, declarations, imports, calls,
each pinned to a byte range. The curated examples read differently because a person also
wrote the part no parser can produce: what the project is for, which responsibilities it
splits into, what each important object is for, why two parts are connected, and which
task to follow first. That writing is the product. This document specifies how
`skylense enrich` produces it for a repository it has never seen, and why the result can
be trusted to the degree it is labelled.

## Three kinds of content

| Kind | Source | Produced by |
| --- | --- | --- |
| Derived | parsed from the snapshot: files, declarations, imports, calls, line ranges | `analyzeSource`, unchanged |
| Authored | judgement: purpose, responsibility regions, object roles, relation reasons, task scenarios, reading order | an **author host** (a language model the user names), under the constraints below |
| Rendered | layout, palette, drilling, paths, motion, export | the existing workbench |

Authoring never edits a derived fact. No authored item can create, upgrade or remove a
relation, change a resolution, or alter an excerpt. Authored items are claims in
`analysis.claims` plus presentation fields projected from those claims, every one of them
labelled as agent interpretation.

## Why authored text is safe to show

1. **It cannot quote what it did not read.** The author cites `{file, lines:[start,end]}`
   only. The builder slices those lines from the snapshot bytes, after re-checking the file
   digest, and mints the evidence record itself. An author never supplies excerpt text.
2. **It cannot invent structure.** Every node id, edge id and path the author names must
   exist in the derived model. A scenario step must traverse an existing edge between the
   two objects it connects. A region must list real paths; every file lands in exactly one
   region.
3. **It is checked by someone else.** A separate verifier call sees only the claim and its
   sliced excerpts, not the author's reasoning, and returns `supported`, `partial` or
   `unsupported`. Unsupported claims get one repair round and are dropped if they fail
   again; dropped claims are listed, not hidden.
4. **It is labelled on the surface.** Every authored sentence carries its verification
   status and its citations. `review` stays `proposed`: only a person can check a claim,
   and `deepMapReady` stays false.
5. **Source text is data.** Excerpts are sent inside delimited, line-numbered blocks with
   an explicit instruction that they are not instructions. The host runs with no tools,
   its output is constrained by a JSON Schema, and the validator rejects instruction-like
   text and anything referencing ids outside the snapshot.

## Pipeline

```
analyze (or load model.json + --root)
  → orientation    1 call      brief, regions, start-here, entry candidates
  → apply regions               regions become top-level containers beside the original root
  → one priority queue, each call reading only the orientation:
      relations    1 call      why regions depend on each other; reasons for key edges
      scenarios    1 call      2–6 task walks over existing edges
      objects      N calls     role and interface meaning for ranked key objects (batched, by rank)
  → validate + repair (≤ 1 round per stage)
  → enclosing-def cites         a text naming the declaration a cite falls inside also cites its def line
  → apply claims (unverified)
  → verify         M calls      independent verdict per claim (batched, parallel)
  → repair unsupported (≤ 1 round) → re-verify
  → final apply from the base model: claims, obligations, projection, meta.authoring
  → report (coverage, cost, rejections) → write .json or self-contained .html
```

After orientation, relations, scenarios and the objects batches (by rank, lowest last) form
one priority queue. Each round admits up to `--concurrency` calls in queue order, none
ahead of a waiting earlier one; the objects batches therefore absorb any shortfall of the
authoring share: once a batch does not fit, it and every lower-ranked batch are skipped and
reported. Verify and revise calls run concurrently up to `--concurrency`. Every stage prompt is
capped in characters as a whole (orientation 80 000, objects 60 000, relations 50 000,
scenarios 60 000, verify 50 000, revise 40 000): lists beyond the cap are cut in their
ranked order and the prompt states how many entries were left out. Before every call the
budget reserves a multiple of an estimate from the prompt length and the highest cost per
prompt character observed so far for the same stage: 1.5 × once that stage has an
observation, 2.5 × while it has none (the estimate then uses the orientation call's rate;
before any observation, 0.000006 USD per character), and at least 1.25 × the largest
single call observed so far for the same stage (no floor while that stage has none). A call
is admitted only when its reservation fits what its budget pool has left after the
reservations of the calls admitted with it. Its hard spending cap is its
reservation plus an equal share of what the pool has left unreserved among the calls of its
round, so the caps of a round never add up to more than the pool. A call stopped at its cap
is retried once, alone with nothing in flight, capped at all that is left in its pool when
that is more than the cap it failed at; both attempts are charged. With verification
on, authoring stages may spend at most 70 % of the budget; the rest is reserved for verify
and revise. A call that does not fit while other calls are in flight waits for them and is
admitted against the actual spend; with nothing in flight, a call whose reservation does not
fit but whose estimate does is made alone, capped at all the room left in its pool, and a
call is skipped only when even its estimate does not fit. A skipped call is not made, the run still produces a valid model, and the skipped
work is reported in coverage.

## Module layout and ownership

| File | Purpose |
| --- | --- |
| `lib/authoring/schemas.mjs` | JSON Schemas of every host output, the claim-id scheme, closed vocabularies. Shared by all modules. |
| `lib/authoring/hosts.mjs` | Host adapters: `claude`, `command`, `replay`, and the recording wrapper. |
| `lib/authoring/context.mjs` | Source reader with digest checks; key-object ranking; per-stage context assembly. |
| `lib/authoring/prompts.mjs` | System and user prompts per stage, built from context; prompt version. |
| `lib/authoring/validate.mjs` | Semantic validation of host output with closed rejection codes. |
| `lib/authoring/apply.mjs` | Evidence minting, region re-parenting, claim application, obligations, projection, `meta.authoring`. |
| `lib/authoring/enrich.mjs` | Orchestrator: stage DAG, batching, repair, verification, budget, report. |
| `bin/skylense.mjs` | `skylense enrich` command. |
| `src/app.js` (+ css) | Rendering of the authored layer. |
| `scripts/verify-authored-model.mjs` | Independent checker of an enriched model; does not import `lib/authoring/*`. |

## Host output contract

All host outputs are JSON objects validated first by the JSON Schema in
`lib/authoring/schemas.mjs`, then semantically by `validate.mjs`.

**Cite** — one of:
- `{ "file": "<snapshot path>", "lines": [start, end] }`: 1-based, inclusive,
  `1 ≤ start ≤ end`, `end − start ≤ 39`, within the file;
- `{ "evidenceId": "<existing evidence id>" }`.

Every authored text carries `cite: [Cite, …]` with 1–4 entries. Text limits are in
characters; `lang` (default `zh`) sets the language of every free-text field. Code
identifiers, paths and quoted source stay as written.

**Enclosing-def cites.** After validation and before verification, the builder may add a
def/class line to the cites of an authoring-stage text (§ Evidence minting). The author's
cites stay as they were in `accepted`; what the builder added is recorded separately.

**orientation**
```json
{
  "brief": {
    "title": "≤ 60",
    "purpose": { "text": "≤ 280", "cite": [] },
    "capabilities": [{ "text": "≤ 160", "cite": [] }],
    "inputs":  [{ "text": "≤ 160", "cite": [] }],
    "outputs": [{ "text": "≤ 160", "cite": [] }],
    "boundary": [{ "text": "≤ 160", "cite": [] }],
    "audience": "≤ 120"
  },
  "regions": [{
    "key": "[a-z0-9-]{1,32}",
    "label": "≤ 16",
    "description": { "text": "≤ 200", "cite": [] },
    "rationale":   { "text": "≤ 200", "cite": [] },
    "paths": ["snapshot directory or file path"]
  }],
  "startHere":   [{ "path": "file path", "symbol": "optional qualified name", "reason": { "text": "≤ 200", "cite": [] } }],
  "entrypoints": [{ "path": "file path", "symbol": "optional", "reason": { "text": "≤ 200", "cite": [] } }]
}
```
Counts: capabilities 2–6; inputs, outputs 0–6; boundary 0–5; regions 3–8; startHere 1–5;
entrypoints 0–6.

**objects** (one batch of ≤ 12 node ids chosen by the orchestrator)
```json
{ "objects": [{
    "nodeId": "id from the batch",
    "summary": "≤ 80",
    "role":      { "text": "≤ 400", "cite": [] },
    "interface": { "text": "≤ 300", "cite": [] }
}] }
```
`interface` is omitted for nodes whose profile forbids a function interface (document,
config, asset, external, container).

**relations**
```json
{
  "regionRelations": [{ "from": "region key", "to": "region key",
                        "reason": { "text": "≤ 200", "cite": [] },
                        "relationIds": ["existing relation id", "…"] }],
  "edgeReasons": [{ "edgeId": "existing edge id", "reason": { "text": "≤ 200", "cite": [] } }]
}
```
A region relation needs ≥ 1 backing relation whose endpoints lie in `from` and `to`.

**scenarios**
```json
{ "scenarios": [{
    "key": "[a-z0-9-]{1,32}",
    "label": "≤ 24",
    "description": { "text": "≤ 300", "cite": [] },
    "steps": [{ "nodeId": "existing node id",
                "viaEdgeId": "edge connecting the previous step's node and this one; null on step 1",
                "reason": { "text": "≤ 200", "cite": [] } }]
}] }
```
2–6 scenarios, 3–12 steps each. The edge may point either way; the builder records
`direction: "forward" | "reverse"` and the edge's resolution, so a step resting on an
unproven call is shown as such.

A later step may set `viaEdgeId: null`: a **narrative step**, for a hand-over no code
relation records (a protocol document telling an agent to edit a file, a script whose
output another reads). The builder records `direction: "narrative"` and `resolution: null`;
its reason must cite the lines that state the hand-over. The workbench shows it as
叙述衔接 · 无代码关系 and never draws it as an edge. Every scenario keeps at least one step
on an existing edge; a scenario without one is dropped (`COUNT_OUT_OF_RANGE`).

**verify**
```json
{ "verdicts": [{ "claimId": "…", "verdict": "supported | partial | unsupported", "reason": "≤ 200" }] }
```

**revise** (the repair round after verification; one call per batch of unsupported claims)
```json
{ "revisions": [{ "claimId": "…", "text": "within that claim's limit", "cite": [] }] }
```
The author sees each claim, its excerpts and the verifier's reason. A claim it omits is
withdrawn. A revision keeps the claim id, is validated like the original and is verified
again; a claim still unsupported is dropped and listed in `rejected`. A summary takes its
role's effective cites. When a role revision is re-verified, the summary of that role is
judged again in the same batch, unless it was itself revised or dropped. If the role
revision stands, the summary gets the new cites and the new verdict, and its builder-added
cites lapse.

## Validation rejection codes

`CITE_MISSING`, `CITE_FILE_UNKNOWN`, `CITE_FILE_UNREADABLE` (no exact text or digest
mismatch), `CITE_RANGE_INVALID`, `CITE_RANGE_TOO_LONG`, `CITE_EVIDENCE_UNKNOWN`,
`TEXT_EMPTY`, `TEXT_TOO_LONG`, `COUNT_OUT_OF_RANGE`, `UNKNOWN_NODE`, `NOT_IN_BATCH`,
`UNKNOWN_EDGE`, `UNKNOWN_RELATION`, `EDGE_NOT_CONNECTING`, `RELATION_NOT_BETWEEN_REGIONS`,
`REGION_KEY_DUPLICATE`, `REGION_PATH_UNKNOWN`, `REGION_PATH_OVERLAP`, `UNKNOWN_REGION`,
`SCENARIO_KEY_DUPLICATE`, `FORBIDDEN_SHAPE`, `INSTRUCTION_TEXT`, `UNKNOWN_CLAIM`; after
validation: `VERIFY_UNSUPPORTED` (still unsupported after revision), `REVISION_WITHDRAWN`,
`HOST_FAILED` (the stage's call failed), `BUDGET_EXHAUSTED` (the call was not made).
A rejection names the JSON path of the item (`regions[2].paths[0]`), the code and a
detail. Rejected items, not whole outputs, are dropped; the repair round sends the
rejections back to the host. An objects batch whose output leaves out a batch object gets
one `COUNT_OUT_OF_RANGE` rejection per missing node, with path `batches[<i>]` (the call) and
detail `missing from host output: <nodeId>`. The repair round asks for these, and each one
is final unless the repair supplies that object.

## Evidence minting

A cited line range becomes one record:
`SkylenseAnalysisIR.evidence({ id, snapshotId, fileId: path, decodedText: fullText,
decodeStatus: "exact", range: { startUtf16, endUtf16 }, producer: { adapter:
"skylense-authoring", version: "1", mode: <stage> } })`, where the range runs from the
first character of `start` to the end of `end` excluding its line terminator, and
`id = "ev_auth_" + sha256(snapshotId|path|start|end).slice(0, 16)`. Records are deduplicated
by id. The file text comes from the source reader, which refuses a file whose sha256 does
not equal the snapshot's `decodedTextHash`.

**Builder-added cites.** A text may cite lines the author did not choose. This happens when
a text names a declaration (by its name or qualified name, as a whole identifier), one of
its line cites starts inside that declaration's body, and no cite of the text shows the
declaration's def/class line. The builder then adds that line. It becomes its own one-line
cite while the text has fewer than 4 cites. Otherwise the author's cite widens up to the
line, if the range stays within 40 lines. Texts never change, and revisions get no added
cites (a revision replaces all cites). The verifier judges the text against all its lines
under the same rules: a call shown under the def line of the function it sits in is
checkable on its own.

`meta.authoring.accepted` keeps the author's cites. Each addition is recorded in
`meta.authoring.addedCites` (`{ [claimId]: [{ file, lines, reason: "enclosing-def",
widened?: true }] }`), in order. A widened entry carries its new range and replaces the
first not yet replaced author cite of that file with the same end line that it contains.
Any other entry is appended. A record that surviving claims cite only through added cites
keeps `producer.mode` (its stage) and adds `producer.rule: "enclosing-def"`. A record that
an author cites has no rule. The independent checker verifies three things. Every claim cite
is an author cite, a revision cite or a listed addition. Each addition's start line is the
def line of a declaration the text names, enclosing one of its author cites. A widened cite
spans at most 40 lines and contains the author range it replaces.

## Claims

One claim per authored statement, applied through `SkylenseClaimValidation.apply` with
the author identity as principal. Ids are derived from the subject, never from the text,
so a re-run maps verdicts and repairs onto the same ids.

| Authored item | Claim id | Predicate | Subjects | Facts |
| --- | --- | --- | --- | --- |
| purpose | `cl_auth_purpose` | design-note | root container | — |
| capability / input / output / boundary *i* | `cl_auth_capability_<i>` … `cl_auth_boundary_<i>` | design-note | root | — |
| region description | `cl_auth_region_<key>` | responsibility | region container | — |
| region rationale | `cl_auth_region_<key>_members` | module-membership | region + ≤ 20 members | — |
| start here *i* | `cl_auth_start_<i>` | design-note | node | — |
| entry candidate *i* | `cl_auth_entry_<i>` | design-note | node | — |
| object summary | `cl_auth_summary_<nodeId>` | responsibility | node | — (cites: the role's effective cites, revised ones included) |
| object role / interface | `cl_auth_role_<nodeId>`, `cl_auth_iface_<nodeId>` | responsibility | node | — |
| region relation | `cl_auth_regionrel_<from>_<to>` | design-note | both regions | backing relations |
| edge reason | `cl_auth_edge_<edgeId>` | design-note | both endpoints | the relation |
| scenario | `cl_auth_scenario_<key>` | design-note | first step node | all step relations |
| scenario step *i* | `cl_auth_scenario_<key>_step_<i>` | scenario-step | step node | the step's relation |

`basis` is `inference` unless the claim text literally quotes a cited excerpt (then
`source-statement`, or `documentation-statement` for documentation files). `support` is
`supported` only for such a literal quote and `insufficient` otherwise, even when the claim
references relations: the relation proves that a binding exists, not the authored reason
for it. `review` is always `proposed`. `author.model` and `author.promptVersion` are filled.

An input model that already carries `meta.authoring`, `region_*` containers, `cl_auth_*`
claims or `ev_auth_*` evidence is refused before any host call: enrich the source folder
or the base model instead. Minting never reuses an evidence record without re-slicing it.
Every timestamp written by the run, including obligation history, is the injected `now`
(`0` is a valid `now`). When no region survives validation the hierarchy is not re-cut,
`meta.landing` and `defaultScope` are left unchanged, and the run reports it.

The verifier's verdict is a separate, weaker signal and lives in
`meta.authoring.verdicts`, never in `support` or `review`.

## Regions

Regions become top-level containers `region_<key>` with `sourceRole: "authored-region"`,
`kind: "container"`, `parentId: null`, `level: 1`, `group` = its own id, a `color` from a
fixed palette of pairwise-distinct colours (`REGION_PALETTE`; the unassigned region uses
`UNASSIGNED_COLOR`), and a `description`. Each region is also a `model.groups` entry
`{ id, label, color, description }`. This is the shape of the curated examples and the one
`AtlasGraph.validate` (`src/graph.js`) admits: every group is a top-level container and
every node's `group` equals its top-level ancestor, so every container and node placed
under a region gets `group: "region_<key>"` and is coloured by it. The original root
container and its group stay top-level and keep only what no region holds (for example
the external-dependency scope).

A region path is a directory, a file, or a **split entry** `"<file path>::<qualified name>"`
naming one top-level declaration of a file, so one large file can be divided by
responsibility (a single training script holding model, optimiser and run loop). The
units of assignment are files, except that a file named by at least one split entry is
replaced by its top-level declarations. A unit's region is the most specific matching
entry: an exact split entry, else the most specific file or directory path. A split file's
own module node, and every declaration no split entry names, go to the region its path
falls in, or, when no path covers it, to the region holding most of its declarations
(ties: earlier region). Units no entry covers go to `region_unassigned` (label 未归类),
created only when needed. A split entry naming a nested or unknown declaration is
`REGION_PATH_UNKNOWN`; two regions listing the identical entry is `REGION_PATH_OVERLAP`.

Then the original tree is re-cut: the highest container whose units all belong to one
region moves, with its whole subtree and its ids, under that region. A container whose
units span several regions, including a split file's container, is dissolved: its
children move individually, the container leaves the hierarchy, and every reference to it
(parentId, claim subjects, flow anchors) is rewritten to the region holding most of its
units (ties: earlier region). The original root is never dissolved. Every dissolution is
recorded in `meta.authoring.regionPlan.dissolved`; `regionPlan.assignments` maps every unit
(path or split entry) to its region. Nodes keep their `path`, so the real location of every
object stays visible. Nodes without a snapshot file (external packages) follow their
parent. Dictionaries keyed by paths, ids or names are `Map`s or null-prototype objects read
with `Object.hasOwn`: `constructor`, `__proto__` and `toString` are ordinary names here.

## Projection

Presentation fields are a deterministic function of the claims and `meta.authoring`
(`project(model)`); re-projecting an enriched model yields the same bytes.

- **Region container:** `label`, `description` (region claim), `color`, `evidence`
  (legacy `{file, lineStart, lineEnd, excerpt}` entries from the minted records),
  `evidenceStatus: "agent-interpretation"`, `interpretation`.
- **Node with a role:** `summary` ← summary claim, `description` ← role claim,
  `interface` ← interface claim, each only when its own claim survives; previous values
  are kept in `derivedSummary` / `derivedDescription`; `interpretation`.
- **Edge with a reason:** `description` ← reason; previous value in `derivedDescription`;
  `interpretation`. `evidenceStatus` keeps its derived meaning.
- **Scenario:** a flow `scenario_<key>` with `kind: "authored-scenario"`, `label`,
  `title`, `description`, `nodes`, `edgeIds`, `anchorId`, `intent: "scenario"`, and
  `steps: [{ nodeId, edgeId, direction, resolution, reason, claimIds, evidenceIds }]`;
  authored scenarios come first in `model.flows`, generated guides stay after them.
- **Document** `auth_overview`: title 如何阅读 <title>, `status: "authored-reading-guide"`,
  Markdown built from the brief, regions, start-here and scenarios, each statement followed
  by its `path:Lstart-Lend` citations.
- **meta:** `description` ← purpose (previous value in `derivedDescription`),
  `evidenceNote` extended with the authoring note, `defaultScope: "system"` (the overview
  of all top-level regions), `landing: "orientation"`, and `authoring` (below).

`interpretation` is `{ status, claimIds, fields }`: `fields` maps each projected text field
(`summary`, `description`, `interface`, a step's `reason`) to the one claim id it shows, and
`status` is the weakest status of those claims, from the closed vocabulary: `verified`
(independent verifier: supported), `partly-verified` (partial), `unverified` (no verdict:
verification off, budget exhausted or verifier failure). A surface grades a field by its
own claim, never by the node's overall status. Claims the verifier rejected after repair
are never projected; a field whose claim was dropped keeps its derived value and is shown
as derived. No authored text is projected without a claim: the object summary is a claim
of its own, verified against the role's citations. Names are not claims and are never
graded: region labels and scenario labels/titles are not in `fields`, and surfaces mark
them 代理命名 by `sourceRole: "authored-region"` and `kind: "authored-scenario"`. A scenario
whose description and step claims were all dropped is not projected; one whose description
was dropped keeps its steps, labelled by its scenario key. A layer that fails its shape
check (including an `interpretation` without `fields`) is not trusted by any surface: every
projected field falls back to its stored derived value, authored regions are marked 代理划分
and scenarios 代理场景, text they keep 代理解读 · 未采信, and one notice line (代理解读层格式不正确，
不予采信：…) says why. The Web, TUI, CLI and MCP surfaces use these same words.

A verdict always counts: a verdict whose reason fails a text check keeps its verdict and
loses only the reason. A `rejected` entry carries `final`: `false` when a later repair
round accepted the same item, `true` otherwise; coverage counts only final entries, so every
authored item is counted exactly once as projected, finally rejected or skipped.

## `meta.authoring`

```json
{
  "schemaVersion": 1,
  "generator": "skylense-authoring/1",
  "snapshotId": "…",
  "lang": "zh",
  "host": { "kind": "claude", "model": "…", "effort": "…", "isolation": "bare|user-context|n/a", "authorIdentity": "author:claude:<model>", "verifierIdentity": "verifier:claude:<model>" },
  "promptVersion": "authoring-prompts/5",
  "createdAt": "ISO-8601",
  "accepted": { "orientation": {}, "objects": [], "relations": {}, "scenarios": {} },
  "revisions": { "<claimId>": { "text": "", "cite": [] } },
  "addedCites": { "<claimId>": [{ "file": "", "lines": [0, 0], "reason": "enclosing-def", "widened": true }] },
  "brief": { "title": "", "purpose": { "text": "", "claimId": "", "status": "", "evidenceIds": [] }, "capabilities": [{ "text": "", "claimId": "", "status": "", "evidenceIds": [] }], "inputs": [], "outputs": [], "boundary": [], "audience": "" },
  "regions": [{ "id": "region_<key>", "key": "", "label": "", "description": "", "rationale": "", "color": "", "paths": [], "claimIds": [], "status": "" }],
  "regionPlan": { "assignments": { "<unit>": "region_<key>" }, "dissolved": [{ "id": "", "path": "", "mappedTo": "" }], "unassignedFiles": [] },
  "startHere": [{ "nodeId": "", "reason": "", "claimId": "", "status": "" }],
  "entrypoints": [{ "nodeId": "", "reason": "", "claimId": "", "status": "", "proven": false }],
  "objects": [{ "nodeId": "", "claimIds": [] }],
  "regionRelations": [{ "from": "", "to": "", "reason": "", "relationIds": [], "claimId": "", "status": "" }],
  "scenarios": [{ "flowId": "", "claimIds": [] }],
  "verdicts": { "<claimId>": { "verdict": "supported|partial|unsupported", "reason": "", "verifier": "" } },
  "rejected": [{ "stage": "", "path": "", "code": "", "detail": "", "final": true }],
  "coverage": {
    "files": { "inRegions": 0, "total": 0 },
    "keyObjects": { "authored": 0, "ranked": 0 },
    "claims": { "projected": 0, "verified": 0, "partlyVerified": 0, "unverified": 0, "rejected": 0 },
    "obligations": { "closed": 0, "open": 0, "total": 0 },
    "skipped": [{ "stage": "", "reason": "" }]
  },
  "cost": { "calls": 0, "usd": 0, "inputTokens": 0, "outputTokens": 0, "byStage": {} },
  "gradeVocabulary": { "verified": "…", "partly-verified": "…", "unverified": "…", "agent-interpretation": "…" }
}
```
`accepted` holds the validated stage outputs exactly as applied, so `project(model)` and
the independent checker can rebuild and compare everything else.

## Obligations

After claims are applied and obligations re-derived, authored claims whose subject owns an
open obligation (`ob_boundary_*`, `ob_module_<container>`, `task_resp_<node>`,
`ob_relation_<relation>`, `ob_scenario_*`) go through the existing protocol:
`acquireObligationLease(owner = author identity)` → `submitProposal` →
`verifyObligation(verifier = verifier identity)`, `confirmed` only for a `supported`
verdict. Partial and unverified claims leave the obligation `proposed`. The ledger
therefore says how much of the map an independent check confirmed, and the open
remainder stays in the denominator.

## Hosts

```js
createHost({ kind: 'claude' | 'command' | 'replay', model, effort, command, args, dir,
             concurrency = 4, timeoutMs = 600000, maxRetries = 2,
             isolation = 'auto' | 'bare' | 'user-context', recorded })
// → { kind, label, model, identity(role), describe(), complete(request), usage() }
// describe() → { kind, label, model, effort, isolation }; isolation is the effective mode
// ('bare' | 'user-context', 'unknown' before an auto host settles, 'n/a' for command/replay)
// request:  { stage, role: 'author' | 'verifier', system, prompt, schema, key }
// response: { ok: true, data, usage: { inputTokens, outputTokens, costUsd, durationMs } }
//         | { ok: false, error: { code, message, retriable } }
recordingHost(inner, dir)   // wraps any host; writes <dir>/<key>.json
```
`key = sha256(stage|role|system|prompt|JSON(schema)).slice(0, 24)`. `claude` runs
`claude -p --tools "" --no-session-persistence --output-format json --json-schema …
--system-prompt … --max-budget-usd <cap>` with the prompt on stdin, in an empty working
directory, and reads `structured_output`. `auto` isolation runs the first call with
`--bare` (no CLAUDE.md, memory or hooks of the user reach the prompt); when that fails to
authenticate it switches to `--setting-sources "" --strict-mcp-config
--disable-slash-commands` and warns that user context may be included. Every response
carries usage summed over its attempts, failed ones included. `command` writes the request
as JSON to the command's stdin and reads `{ data, usage? }` from stdout. `replay` reads
recorded responses and fails with `REPLAY_MISS` naming the stage and key; `--record`
also writes `run.json` (`now`, prompt version, budget, `describe()`) so a replay
reproduces the run byte for byte.

## Command

```
skylense enrich <source|model.json> [--root <dir>] --host claude|command|replay
  [--host-command <cmd>] [--host-model <id>] [--effort low|medium|high]
  [--host-isolation auto|bare|user-context] [--budget <usd>] [--max-objects <n>]
  [--max-files <n>] [--concurrency <n>] [--lang zh|en] [--verify independent|none]
  [--record <dir>] [--replay <dir>] --output <file.json|file.html> [--force] [--json]
```
Defaults: budget 4 USD, 48 key objects, concurrency 4, `zh`, independent verification.
Before the first call it prints the host, that source excerpts are sent to it, and the
budget. A model file input needs `--root` so citations can be sliced from real bytes.
Everything checkable is checked before the first call: flag values, the output target,
every snapshot file's digest under `--root`, and refusal of an already-enriched model.

## Key-object ranking

Score per non-test, non-generated, non-vendored code node (files and top-level declarations):
`2·fanIn + fanOut + 3·crossRegionEdges + 6·isEntryCandidate + 4·isStartHere + 2·isPublic`
over resolved and candidate relations; ties by path. File nodes take at most half of the
ranked slots (files carry the import edges and would otherwise crowd out declarations on
large repositories); start-here and entry objects are always ranked. Tests, generated
files and vendored code are only ranked when a region consists of them. Unranked objects
keep only derived fields and stay as open obligations.

## Vendored code

Ingest decides once per snapshot which directories hold another project's code
(`SkylenseIngest.vendoredRoots`) and records them as `meta.ingestion.vendored`
(`{ path, signal, files }`, outermost directories only). Key-object ranking, the authoring
contexts and the reading guides (category `vendored`) all read that record. Vendored files
stay in the model and are analysed. A directory below the root is vendored on one of these
structural signals; project names play no part:

- `vendor-directory`: named `third_party`, `third-party`, `3rdparty`, `vendored` or
  `bower_components` (`vendor/` is a built-in ingest exclusion and never reaches the model).
- `versioned-source-tree`: named `<name>-<major>.<minor>[…]` and holding its own licence,
  README or build system (`configure`, `configure.ac`, `CMakeLists.txt`, `Makefile.in`,
  `meson.build`), unless a licence there equals the root licence or cannot be read (a
  monorepo package versioned in place).
- `foreign-license`: a child of `external/`, `deps/`, `lib/` or `libs/` holding a licence
  whose text differs from every root licence. A project's own `lib/<name>` without a
  licence file of its own is not vendored.
- `prebuilt-sdk`: holding `include/` plus a `lib/` or `bin/` with `.a`, `.lib`, `.dll`,
  `.so` or `.dylib` files.

Licence texts are compared after collapsing whitespace; an unreadable licence never counts
as foreign. A model built before the record existed is classified from its paths alone,
so the licence signals cannot fire for it.

## Acceptance for an unseen repository

- Every authored citation re-slices byte for byte; changing one cited line fails the check
  naming the claim.
- Every projected text equals its claim; every claim's evidence exists in this snapshot.
- No derived relation, resolution or excerpt differs from the base model.
- Every unit (file, or top-level declaration of a split file) is in exactly one region;
  3–8 authored regions; distinct colours.
- Every scenario step traverses an existing edge between its two nodes, or is a narrative
  step with a citation, shown as such; every scenario has at least one edge step.
- The landing view shows the regions and the brief, not a file listing.
- Rejected, unverified and skipped work is reported, never dropped from the denominator.
- `deepMapReady` stays false.
