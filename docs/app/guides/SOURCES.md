# Open your own source

Skylense 0.3 turns selected files, local folders, public GitHub repositories and public webpages into a model for the **same complete visual workbench**. No API key is required for the static analyzer. It never executes the analyzed code or page scripts.

## In your browser

Choose **打开来源 / Open source**. Select a folder, select files, enter a URL, or paste text/HTML. Review the coverage report, then enter the map. Canceling or a failed analysis keeps the map you were reading. Export the model JSON before closing or reloading if you want to keep it.

- **Folders/files:** the selected contents are read inside the browser; they are not uploaded to Skylense. The folder picker must be supported by your browser; individual file selection is the fallback.
- **Public GitHub:** use `https://github.com/owner/repo`, optionally `/tree/branch/subfolder` or `/blob/branch/file`. The fetched repository is pinned to the resolved commit. GitHub rate limits apply; private repositories are not fetched with account credentials. Clone a private repository using your own tools, then open its local folder.
- **Webpages:** direct browser retrieval requires the website to permit cross-origin access. When blocked, use the local CLI below or upload a saved HTML page. Skylense does not proxy private data through a hosted service.

## From the CLI

Install the downloaded `skylense-0.3.1.tgz` with Node.js 22+:

```sh
npm install --global ./skylense-0.3.1.tgz
skylense open /path/to/project
skylense open https://github.com/karpathy/autoresearch
skylense open https://example.com
```

`open` analyzes the source and starts the complete Web app on a random loopback port. Its access token is delivered in the URL fragment, then removed from the visible URL and kept only in the local tab session. Keep the process running; press Ctrl-C to stop. It serves the packaged app, never the source directory. Add `--no-browser --json` to return the local URL to a script.

```sh
skylense analyze /path/to/project --output architecture.json
skylense analyze https://github.com/owner/repo --max-files 500 --json
skylense tui custom --model architecture.json
skylense open architecture.json
```

An existing validated Skylense model is opened without flattening its authored hierarchy, function contracts, scenarios or evidence. Output files are created exclusively; `--force` explicitly replaces an existing regular file. `skylense serve` opens an empty local workbench where URL reading can use the local reader without browser CORS restrictions.

## What the automatic map means

| Source | Automatic result |
| --- | --- |
| A folder of any file types | Folder/file hierarchy, file type, available text preview or metadata-only status |
| Python / JavaScript / TypeScript | Lexical declarations and imports that resolve to included files; original line evidence |
| HTML / Markdown | Authored headings and explicit document references; webpage links can appear as clearly marked, unfetched targets |
| Other text formats/languages | Text/source preview and hierarchy; no unsupported call-graph claims |
| PDF, office documents, images, archives or other binary content | File metadata; their internal content is not decoded by this version |

Imports are static candidates, not verified runtime calls. Dynamic dispatch, framework registration, aliases and external package resolution are not inferred. The analyzer creates no execution scenarios. An agent can author richer roles, contracts and guided scenarios with source evidence using the [model contract](MODEL.md); the existing viewer already supports those fields.

Default limit: **300 files**, adjustable to **1,000**. Hierarchy plus file/section/reference entities are capped at **1,000**; text is bounded to **256 KiB/file and 10 MiB total**. Serialized model export is capped at 14 MiB; previews can be shortened to fit and are marked accordingly. The report records truncation, unreadable files, skipped paths and unresolved references. Large repositories should be opened one subfolder at a time. GitHub may also truncate its recursive file inventory. Webpages use returned HTML/text, not a login session, rendered JavaScript application, or recursive whole-site crawl.

Known generated directories, version-control data and common secret filenames are excluded. Local CLI scans also apply root `.gitignore` and `.skylenseignore` patterns; nested ignore rules and every Git pattern edge case are not implemented. Browser folder selections apply the same root ignore patterns and built-in exclusions; empty directories cannot be provided by the browser file picker. Symlinks are not traversed. CLI/local-reader public requests reject private/reserved network addresses and nonstandard ports. Direct browser requests block known local address literals but cannot independently verify DNS destinations; browser and CORS restrictions also apply.

## Same workbench, every source

Hierarchy, same-level focus, category boundaries, orthogonal animated relationships, node/edge inspectors, source previews, upstream/downstream/global context, ordered-waypoint routes, comparison, saved views, themes, JSON/SVG export and presentation all consume the same model. Data that the analyzer cannot establish is shown as unavailable or unresolved rather than invented.

An agent receives source excerpts when you query through MCP. Your agent host controls subsequent use of those results. [Privacy](../PRIVACY.md) · [Agent setup](AGENTS.md)
