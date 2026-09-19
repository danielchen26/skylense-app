# Open your own source

Skylense 0.4 indexes selected files, local folders, public GitHub repositories and public webpages for the **same complete visual workbench**. Full indexing is the default: eligible files and supported source declarations are retained rather than taking the first 300 files. No API key is required. Analyzed programs and webpage scripts are never executed.

## In your browser

Choose **打开来源 / Open source**. Select a folder or files, enter a URL, or paste text/HTML. Review collection coverage, parser diagnostics and relationship provenance, then enter the map. Canceling or a failed analysis keeps the previous map. Export model JSON if you want a portable snapshot.

- **Folders/files:** selected contents are read locally in the browser. The folder picker must be supported by your browser; individual file selection is the fallback.
- **Public GitHub:** use `https://github.com/owner/repo`, optionally `/tree/branch/subfolder` or `/blob/branch/file`. Source links are pinned to the resolved commit. Rate limits apply; account credentials are not collected. Clone private repositories with your own tools, then open their local folders.
- **Webpages:** direct browser retrieval requires the website to permit cross-origin access. Use the local CLI or upload saved HTML when it does not. The returned page source is indexed; this does not log in, execute page scripts or recursively crawl a site.

Remote requests have timeouts and cancellation. An incomplete GitHub tree, unreadable required source, or a resource ceiling stops full indexing with an error; it is not presented as a complete result.

## From the CLI

Install the downloaded toolkit with Node.js 22+:

```sh
npm install --global ./skylense-0.4.0.tgz
skylense open /path/to/project
skylense open https://github.com/danielchen26/Gflownet
skylense open https://example.com
skylense analyze /path/to/project --output architecture.json
skylense tui custom --model architecture.json
skylense open architecture.json
```

`open` starts the complete packaged Web app on a random loopback port. Its token is delivered in the URL fragment, removed from the visible URL and retained in the local tab session. Keep the process running; Ctrl-C stops it. It serves the packaged app, never the source directory. Use `--no-browser --json` for a script. `skylense serve` opens an empty local workbench whose URL reader can work without browser CORS restrictions.

Existing validated Skylense JSON preserves authored hierarchy, contracts, scenarios and evidence. Output files are created exclusively; `--force` replaces an existing regular file explicitly.

For an intentionally smaller, partial map, opt into a file limit:

```sh
skylense analyze /path/to/project --max-files 300 --output quick-preview.json
```

This is **preview mode**, not the default. Source files are prioritized before documents and generated reports. Preview reports identify omitted files, declaration limits and truncated content.

## What the automatic map establishes

| Layer | Result and evidence boundary |
| --- | --- |
| Collection | Actual folders/files and file types; text previews or explicit binary metadata; public GitHub commit links |
| Syntax | 24 bundled Tree-sitter grammars, covering Python, JavaScript/TypeScript/TSX, Julia, Go, Rust, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, Scala, Lua, shell, HTML, CSS, Vue and structured configuration formats; supported declarations retain source spans and nesting |
| Local dependencies | Source-backed imports, includes, resources and links; project-aware resolution uses included manifests and unambiguous local targets |
| JavaScript / TypeScript calls | The TypeScript checker resolves supported calls to included declarations; these are static bindings, not observations of runtime dispatch |
| Julia calls | Static module/include/import bindings identify candidate method sets; multiple-dispatch candidates remain distinct from resolved calls, with a shared call-site identity |
| External dependencies | Declared package references have separate nodes labeled **unfetched**; their source and runtime availability are not claimed to be indexed |
| Documents | Authored headings and explicit links; static dependency reading guides retain original edge directions and evidence |
| Other formats | Available text and hierarchy; unsupported semantics and binary/PDF/office/image/archive content remain explicit rather than receiving invented connections |

A complete collection is not a complete runtime call graph. Syntax diagnostics, unresolved references, computed imports, generated code, macros and dynamic dispatch retain their uncertainty. An isolated node can mean no supported relationship was established; it does not prove the component is independent. Every generated guide is a source-reading aid, not an execution trace. Agents can add attributed roles, contracts and scenarios using the [model contract](MODEL.md).

## Incremental indexing and resource handling

Unchanged file syntax is reused by content hash, parser version and source path. Changed files are parsed again and project relationships are rebuilt, so a warm run does not keep stale imports merely because an individual source file was cached. The browser uses local IndexedDB; the toolkit uses a local syntax cache. Neither requires a hosted model service. See [Privacy](../PRIVACY.md) for storage details.

Full indexing separates source parsing from preview length. Files and supported declaration/relationship identities are retained. Source-document previews may be shortened, and each node/edge excerpt is bounded, while its file and line references remain available. Preview shortening is reported separately from incomplete source collection. A valid symbol or relationship does not lose its excerpt because an earlier file consumed a global preview allowance.

Finite resource ceilings protect the process: **100,000 files, 64 MiB per text file, 256 MiB total source text and 128 MiB serialized model**. Graph entity and traversal safety ceilings also apply. Exceeding a full-index ceiling produces an explicit failure; choose a narrower source or intentionally request preview mode. Known binary weights are metadata-only and are not read as giant text files. These ceilings do not imply that every device can render the largest possible model equally quickly.

Known generated directories, version-control data and common secret filenames are excluded. GitHub, browser-folder and CLI collection apply the same root `.gitignore` and `.skylenseignore` rules; nested ignore files are not interpreted. Symlinks are not followed. Browser file pickers cannot supply empty directories; local scans can retain them.

CLI public requests reject private/reserved network destinations and nonstandard ports. Direct browser requests block known local address literals, while browser DNS and CORS behavior still apply.

## Same workbench, every source

Hierarchy, same-level focus, category boundaries, orthogonal animated relationships, node/edge inspectors, source previews, upstream/downstream/global context, ordered-waypoint routes, comparison, saved views, themes, JSON/SVG export and presentation all consume the same model. Features have the same controls for imported and curated maps; the available relationships and scenarios reflect the evidence in each model.

MCP returns source excerpts to your connected agent. Analysis responses retain exact diagnostic totals and return bounded samples; the complete report and model remain in the session and protected viewer. If a graph exceeds the raw model tool's response limit, use `skylense_view` or focused queries without reducing source coverage. Your agent host controls subsequent use of returned data. [Agent setup](AGENTS.md) · [Model authoring](MODEL.md)
