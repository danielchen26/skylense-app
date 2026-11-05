# Skylense in the terminal

The terminal explorer reads the same public, pinned architecture models as the Web app. It offers a hierarchy, component details and direct upstream/downstream jumps. These are selected source-reading models, not a complete index of each repository and not measured runtime traces.

Node.js 22 or newer is required. No runtime dependency installation is needed.

```sh
skylense examples
skylense tree autoresearch --depth 4
skylense tui langgraph
```

Download the Agent toolkit from the release page and install the local TGZ first; see [Agent setup](AGENTS.md).

## Commands

| Command | Purpose |
| --- | --- |
| `examples` | List available model IDs, counts and pinned revisions |
| `tree [repo] --depth 4` | Show hierarchy, with a bounded display depth |
| `inspect repo ID` | Read an object, contracts, relationships and source evidence |
| `search repo words... --limit 20` | Search model labels, paths, symbols and summaries |
| `trace repo ID --direction downstream --depth 3` | Traverse directed relationships up to the specified depth |
| `path repo START END --via MID1,MID2` | Find ordered waypoint paths with optional direction, type and hop filters |
| `flows repo` | List reading scenarios; agent-authored ones show graded, edge-by-edge steps |
| `tui [repo]` | Open the interactive terminal explorer |
| `claims [repo\|source] [ID] --limit 100 --cursor …` | Page the claim overlay: current claims, then stale ones, with exact totals |
| `review <source\|model.json> CLAIM_ID --accept\|--reject --reviewer ID` | Record your own human review of one claim |
| `config` | Print generic MCP connection JSON for this machine |
| `mcp` | Run the stdio MCP adapter; stdout is reserved for the protocol |

`tree` and `tui` default to `autoresearch`. Read commands accept `--json` for structured output. `--width 80` bounds plain-text lines; human-readable results are capped, while JSON preserves the selected structured result. Tree depth is 1–16; traversal depth is 0–12. `--direction` also accepts `upstream` and `both`. Unknown flags, repeated flags, extra positional arguments and invalid ranges fail with a nonzero exit status and a diagnostic on stderr.

Use `--` before a search phrase beginning with a dash. For example: `skylense search autoresearch -- --optimizer`.

## Path planning

Plan a path through required intermediate nodes using the same engine as the Web app:

```sh
skylense path autoresearch AR_gpt_forward AR_mlp --via AR_block_forward --limit 3
skylense path custom START END --via WAYPOINT_1,WAYPOINT_2 --direction both --types calls,imports --max-hops 24 --model model.json --json
```

The path command searches the complete stored graph and preserves ordered waypoints, original edge identities and directions. Upstream reading marks reversed steps. It returns a specific unreachable segment or an explicit search limit when it cannot establish a route. `--limit` is 1–3 alternatives for this command; `--max-hops` limits the entire route to 1–48 hops. At most six intermediate nodes are accepted. Paths describe static graph relationships, not observed execution.

## Interactive controls

| Key | Action |
| --- | --- |
| `j` / `k`, ↓ / ↑ | Move through the tree or relation list; scroll details |
| → / Enter | Expand a container, descend into it, open component details, or jump to a linked neighbor |
| ← | Collapse a container or move to its parent; return to the tree from other panes |
| Tab | Cycle through Tree, Details and Relations |
| `u` / `d` | Open direct upstream / downstream relationships |
| `/` | Search model names, paths and function names; Enter applies |
| Esc | Cancel search or clear its filter |
| `q`, Ctrl-C, Ctrl-D | Exit and restore the terminal |

The selected component remains the anchor while changing panes. A container's relation list shows edges crossing its boundary. Relationships preserve their original directions: a `read` edge can point from a reader to its storage, rather than depict data physically moving toward the reader. Resize redraws the screen; narrow terminals clip long text rather than wrap the layout. Source excerpts may include instructions, but those are never executed by the explorer.

When stdin or stdout is not a TTY, `tui` prints a plain snapshot and exits. It does not wait for keyboard input or emit terminal control sequences. For example:

```sh
skylense tui autoresearch > architecture.txt
```

## Saved models and a running app

```sh
skylense tree /absolute/path/to/model.json
skylense inspect /absolute/path/to/model.json COMPONENT_ID --json
skylense tree --bridge 'http://127.0.0.1:PORT/?bridge=local#bridgeToken=…'
```

A saved model's `.json` path can stand where a repository ID goes; `--model <file.json>` with the ID `custom` is the same model, and once a model is supplied an omitted repository means it. `--bridge` takes the URL printed by `skylense serve --json` and answers the read-only queries (`tree`, `inspect`, `search`, `trace`, `path`, `flows`, `tui`, `coverage`, `claims`, `depth`, `capabilities`, `context` without a lease, `query`, `annotations`, `export`) from the model that process holds; host obligations stay with MCP.

The query commands use a validated `.json` architecture model. To create one from a folder/file/URL, run `skylense analyze <source> --output model.json`; to analyze and open the complete visual workbench, run `skylense open <source>`; to send the workbench and its model as one file, run `skylense bundle <source|model.json> --output model.html`. Source programs are not executed, and local files are not uploaded. Public URL analysis makes requests to the selected source. Model text is stripped of terminal control sequences, OSC hyperlinks and bidirectional formatting before text display. JSON mode emits ordinary JSON escaping rather than terminal markup.

## Claims, staleness and human review

```sh
skylense claims path/to/repo --limit 50
skylense claims path/to/repo --cursor "$NEXT" --json
skylense review path/to/repo cl_resp_file_… --accept --reviewer alice@example --note "read main.py:1"
skylense review model.json cl_auth_purpose --reject --reviewer alice@example
```

`claims` pages the claim overlay with `--limit` (1–200, default 100) and the `--cursor` printed as `next page`. Totals are exact; a page is never a truncation. A folder, file or URL argument is analysed first and registered under the same source identity `skylense mcp` uses, so claims a host applied over MCP and reviews recorded earlier are shown. Claims a host applied are kept per source in `~/.cache/skylense/claims/`; after a source edit, a claim whose cited evidence still has identical bytes and whose subjects and facts still exist is carried forward, and every other one is listed as `STALE` with a reason code (`evidence-changed`, `evidence-missing`, `subject-missing`, `fact-missing`) and never applied.

`review` is the human review path: it records `checked` (`--accept`) or `rejected` (`--reject`) with your `--reviewer` identity, the time, the sha256 of the claim text and the evidence ids it was checked against, in the same store. Seed claims, host claims and authored `cl_auth_*` claims are all reviewable. When the claim text or its evidence later changes, the check no longer applies: the claim returns to `proposed` and `claims` prints `review of […] invalidated: text-changed` (or `evidence-changed`). MCP tools and host agents cannot set `checked` or `rejected`; a patch that tries is refused with `REVIEW_NOT_PERMITTED`. `checked` claims show their reviewer in `claims`, `annotations`, `inspect --json` and the `tui` claims list. `depth` lists which dimensions still need a human check; agent verification never satisfies one. In the Web workbench the claims tab pages the same way and offers 核对通过 / 驳回, which ask for your identity and a confirmation and are kept in this browser's local storage.

A review is also bound to the claim's meaning (predicate, subjects, facts): re-filing the same sentence about another object invalidates it (`meaning-changed`, or `content-replaced` when a host overwrites the stored claim). A claim that cites no evidence is bound to its subjects' file content and goes stale (`subject-content-changed`) when that file is rewritten. A damaged store file never stops a command: it is moved aside as `<file>.corrupt-<time>` and `claims --json` reports `overlayStore.error`.

"Human" is a documented assumption, not an enforced fact: Skylense honours a review recorded through `skylense review` or the workbench because a person operates those surfaces, but it cannot tell who ran the command. Anyone who can run the CLI, or edit `~/.cache/skylense/claims/` or the browser's local storage and recompute the hashes, can make a review count. What is enforced is that no MCP tool, claim patch or host-agent path can set `checked` or `rejected`.

## Authored maps (`enrich`)

```sh
node bin/skylense.mjs enrich path/to/repo --host claude --output repo.enriched.json
node bin/skylense.mjs enrich model.json --root path/to/repo --host claude --record recordings/ --output repo.html
node bin/skylense.mjs enrich model.json --root path/to/repo --replay recordings/ --output repo.enriched.json --force
```

`enrich` adds the layer a curated model carries — coloured responsibility regions, per-object summary/role/interface, why-relations, task scenarios and a reading guide — written by a model host you name. Skylense names no provider: `--host claude` runs `claude -p` with no tools in an empty temporary directory, `--host command --host-command "<program> <args>"` runs any program (no shell) that reads the request JSON `{ stage, role, system, prompt, schema, key, maxCostUsd? }` on stdin (`maxCostUsd` is the most that call may spend; `claude` gets it as `--max-budget-usd`) and prints `{ "data": …, "usage"?: … }`, and `--replay <dir>` answers from files written by `--record <dir>` without sending anything. Before the first call the command prints the host, that source excerpts are sent to it, and the budget.

Every authored statement cites line ranges of the analysed files; Skylense slices the excerpts itself from the snapshot bytes after a digest check, an independent verifier call judges each claim (`--verify none` skips it), and unsupported claims are dropped. Authored text is labelled agent interpretation: it never changes a derived relation, resolution or excerpt, never marks anything `resolved-static`, and leaves review `proposed`. A folder argument is analysed first; a model `.json` needs `--root <dir>`, the folder it was analysed from. Before the first call the command checks that the output folder exists and the output is not a folder or symbolic link, that every included file under `--root` still matches the model's digests (it names the first files that do not), and refuses a model that is already enriched. Ctrl+C or a termination signal stops the running host processes and removes their temporary folders. Spend is charged per request, failed attempts and retries included. Options: `--host-model <id>`, `--effort low|medium|high`, `--host-isolation auto|bare|user-context` (claude only; `bare` passes `--bare`, which needs an API key or `apiKeyHelper`; `user-context`, for OAuth logins, loads no settings sources, MCP servers or slash commands, but Claude Code may still add your CLAUDE.md and memory to the prompts, and the command warns when that mode is in effect; the default `auto` tries `bare` on the first call and switches to `user-context` only on an authentication failure; `--record` stores the run clock, prompt version, budget and the host's kind, model, effort, label and mode in `run.json`, and `--replay` answers as that recorded host with the recorded budget unless `--budget` is given, so a replay reproduces the recorded model), `--budget <usd>` (default 4), `--max-objects <N>` (1–500, default 48), `--concurrency <N>` (1–16, default 4), `--lang zh|en` (default `zh`). `--output` takes `.json` or a self-contained `.html` viewer and refuses to replace a file without `--force`; `--json` prints the run report (coverage, cost, rejections, verdicts). When the budget would be exceeded the remaining calls are skipped and reported, and a valid model is still written. The full contract is `docs/AUTHORING.md` in the source repository.

Outside the Web workbench, authored text stays marked. `tree`, `inspect`, `search`, `flows` and the `tui` details pane prefix every authored text field — an object summary, role or interface, a region or edge description, a scenario description or step reason — with its grade, e.g. `[代理解读 · 已核验]` / `[agent interpretation · verified]` (the language follows the authored text). The grade is that field's own claim: `verified` (an independent verifier call judged the cited excerpts to support it), `partly-verified`, or `unverified` (no verdict). Names are not claims: region labels and scenario labels carry a neutral `[代理命名]` / `[agent-named]` and are never graded. The `tui` claims list marks each authored claim with its own grade. Unmarked fields are derived from the source. `flows` lists an agent-authored scenario with each step's edge, direction and resolution — read from the Analysis IR relation, with the step's stored value shown too when it differs — and marks steps without an edge as narrative. A model whose authored layer fails the workbench's shape check (for example an `interpretation` without `fields`) is shown with the workbench's own notice line (`代理解读层格式不正确，不予采信：…`): every projected field shows its stored derived value, authored regions are marked `[代理划分]` / `[agent-divided]` and scenarios `[代理场景]` / `[agent scenario]` — the Web chips' words — and any text they keep `[代理解读 · 未采信]` / `[agent interpretation · not trusted]`. JSON output and MCP results carry `interpretation` (`status`, `claimIds`, and `fields` with each authored field's claim id, status and mark) and `nameMark` for agent-named items; `inspect` and `flow` add the model's grade vocabulary or the notice, and `query`/`export` return items with their `interpretation` unchanged.

## Agent integration

See [the portable integration guide](AGENTS.md). `config` prints configuration only: it does not alter user settings or install a host-specific plugin. Different MCP hosts can require different enclosing configuration keys; the generated executable and argument array remain the important connection values.

```sh
skylense config
skylense config --model /absolute/path/to/model.json
```
