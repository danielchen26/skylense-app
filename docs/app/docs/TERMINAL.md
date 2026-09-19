# Skylense in the terminal

The terminal explorer reads the same public, pinned architecture models as the Web app. It offers a hierarchy, component details and direct upstream/downstream jumps. These are selected source-reading models, not a complete index of each repository and not measured runtime traces.

Node.js 22 or newer is required. No runtime dependency installation is needed.

```sh
node bin/skylense.mjs examples
node bin/skylense.mjs tree autoresearch --depth 4
node bin/skylense.mjs tui langgraph
```

The executable can also be invoked directly as `./bin/skylense.mjs` from this checkout.

## Commands

| Command | Purpose |
| --- | --- |
| `examples` | List available model IDs, counts and pinned revisions |
| `tree [repo] --depth 4` | Show hierarchy, with a bounded display depth |
| `inspect repo ID` | Read an object, contracts, relationships and source evidence |
| `search repo words... --limit 20` | Search model labels, paths, symbols and summaries |
| `trace repo ID --direction downstream --depth 3` | Traverse directed relationships up to the specified depth |
| `flows repo` | List curated reading scenarios |
| `tui [repo]` | Open the interactive terminal explorer |
| `config` | Print generic MCP connection JSON for this machine |
| `mcp` | Run the stdio MCP adapter; stdout is reserved for the protocol |

`tree` and `tui` default to `autoresearch`. Read commands accept `--json` for structured output. `--width 80` bounds plain-text lines; human-readable results are capped, while JSON preserves the selected structured result. Tree depth is 1–16; traversal depth is 0–12. `--direction` also accepts `upstream` and `both`. Unknown flags, repeated flags, extra positional arguments and invalid ranges fail with a nonzero exit status and a diagnostic on stderr.

Use `--` before a search phrase beginning with a dash. For example: `node bin/skylense.mjs search autoresearch -- --optimizer`.

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
node bin/skylense.mjs tui autoresearch > architecture.txt
```

## Explicit local model

```sh
node bin/skylense.mjs tree custom --model /absolute/path/to/model.json
node bin/skylense.mjs inspect custom COMPONENT_ID --model /absolute/path/to/model.json --json
```

Only an explicitly supplied `.json` architecture model is accepted. It is schema-validated by the shared workspace loader and is never evaluated as code. The CLI does not scan source folders or upload files. Model text is stripped of terminal control sequences, OSC hyperlinks and bidirectional formatting before text display. JSON mode emits ordinary JSON escaping rather than terminal markup.

## Agent integration

See [the portable integration guide](../integrations/README.md). `config` prints configuration only: it does not alter user settings or install a host-specific plugin. Different MCP hosts can require different enclosing configuration keys; the generated executable and argument array remain the important connection values.

```sh
node bin/skylense.mjs config
node bin/skylense.mjs config --model /absolute/path/to/model.json
```

## Verification

Run `node scripts/verify-terminal.mjs` for CLI behavior, structured output, error paths, clipping and control-sequence handling. On macOS/Linux with Python 3 available, it also drives a real pseudo-terminal, follows a linked neighbor, searches and verifies cleanup after normal exit and Ctrl-C. It reports a PTY skip explicitly when that environment is unavailable.
