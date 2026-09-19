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
| `flows repo` | List curated reading scenarios |
| `tui [repo]` | Open the interactive terminal explorer |
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

## Explicit local model

```sh
skylense tree custom --model /absolute/path/to/model.json
skylense inspect custom COMPONENT_ID --model /absolute/path/to/model.json --json
```

The query commands use a validated `.json` architecture model. To create one from a folder/file/URL, run `skylense analyze <source> --output model.json`; to analyze and open the complete visual workbench, run `skylense open <source>`. Source programs are not executed, and local files are not uploaded. Public URL analysis makes requests to the selected source. Model text is stripped of terminal control sequences, OSC hyperlinks and bidirectional formatting before text display. JSON mode emits ordinary JSON escaping rather than terminal markup.

## Agent integration

See [the portable integration guide](AGENTS.md). `config` prints configuration only: it does not alter user settings or install a host-specific plugin. Different MCP hosts can require different enclosing configuration keys; the generated executable and argument array remain the important connection values.

```sh
skylense config
skylense config --model /absolute/path/to/model.json
```
