# Privacy and data boundaries

Skylense has no hosted model-upload service or analytics. The static Web app analyzes selected files and JSON in the browser. Choosing a public URL makes requests to that source (and GitHub API/raw-file hosts for GitHub repositories); those providers receive ordinary network metadata and apply their own access limits.

- Bundled examples are public-source snapshots with attributed excerpts and fixed revisions.
- Browser source inputs, imported JSON and generated models remain in the current page session. Incremental syntax facts (including symbol names, references and their source positions) are cached in local IndexedDB for this site; this cache is not uploaded. Clear site data in your browser to remove it. Export JSON to keep the complete model. A hosted-app reload restores a bundled example.
- Selected local files are not uploaded. A failed remote request does not upload the current model.
- Theme/motion preferences use localStorage. Saved views are isolated by model identity/revision; imported models do not overwrite bundled-example bookmarks.
- JSON exports contain model data, source excerpts and documents. SVG exports capture the displayed graph. Review private content before sharing exports.
- Source links open the referenced site. Browser extensions, hosting access logs and agent-provider policies are outside the app's control.

## Local CLI and workbench

The CLI reads the explicit source file/folder, existing model, or public URL. It never executes source programs, installs their dependencies, follows symlinks or runs page scripts. Known generated/dependency/version-control directories and common sensitive filenames are excluded; this is a practical default, not a complete secret detector. Review coverage and exported content before sharing.

`open` and `serve` start the packaged app on loopback with a random token. The source directory is never exposed as a file server. The HTTP analysis endpoint accepts public URLs only; it cannot select arbitrary local folders. Public-network reads reject local/private/reserved addresses, including redirect targets. Browser origin, Host and token checks restrict access to the local workbench.

The token travels in the URL fragment, is removed from the displayed URL after capture, and stays in sessionStorage for that local origin/tab so refresh can restore the server model. Model contents remain in memory. Incremental syntax facts are stored in the local user cache at `~/.cache/skylense/syntax-v1`; cache files use owner-only permissions and are keyed by source-content digest and analyzer revision. Remove that cache directory to clear it. Dependency bindings are recomputed against the current source collection so unchanged callers cannot retain stale targets. Do not share a local token URL with untrusted software on the same machine. Stop the CLI process to close the server.

## Agent access

MCP uses local stdio. Local source analysis is available only under an explicitly configured `--root`; URL analysis reads public HTTP(S) sources. The latest analyzed model occupies one in-memory slot. `skylense_view` can start a local full workbench for that model; these viewers close with MCP. Browser imports do not automatically sync into MCP.

Requested content and excerpts are returned to the agent client, which may send them to its model provider. Read-only source access does not make the agent provider private. Configuration is explicit; Skylense does not modify host settings automatically.

Release packages use explicit file allowlists and public examples. User scans, private working documents and development Git history are not included in the public distribution.
