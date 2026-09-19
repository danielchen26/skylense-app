# Privacy and data boundaries

Skylense Web is a static application. Graph traversal, search and JSON import run in the browser; the interface does not upload imported models or configure analytics.

- Bundled examples are curated public-source snapshots at fixed commits. Their short excerpts, guides and metadata are readable by every visitor and included in exports.
- Browser-imported models stay in the current page session. Switching examples or reloading restores a bundled public model. Export JSON to retain an imported model.
- Theme and motion preferences use localStorage. Saved views are isolated by example identity and revision. Browser imports do not write public-example bookmarks.
- JSON export contains embedded evidence and guides; SVG captures the displayed graph. Downloads are local browser files.
- Source links open GitHub when followed. Hosting providers may log ordinary page requests. Browser extensions and host policies are outside this app's control.

## Local Agent and terminal access

The CLI and MCP server read the same bundled public JSON models. Passing `--model /absolute/path/model.json` explicitly makes that additional model available to the local process. No repository code or imported JavaScript is executed. Models are not automatically synchronized from the browser.

MCP uses local standard input/output. Requested model content and source excerpts are returned to the connected Agent client, which may send them to its configured model provider under its own policies. Read-only tools do not make Agent use private by themselves. Client configuration and installation are explicit; Skylense does not edit host settings automatically.

The release packages use explicit file allowlists. They contain the public examples and app runtime, with no private working documents or development history. The public distribution repository starts from these vetted release files.
