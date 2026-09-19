# Skylense MCP 0.3

Local stdio MCP for analysis and source-model queries. Requires Node.js 22+. The server never executes repository programs or webpage scripts. See the [agent setup guide](../guides/AGENTS.md) and [source capabilities](../guides/SOURCES.md).

```sh
skylense config --root /path/to/project
skylense mcp --root /path/to/project
```

Without `--root`, local source ingestion is disabled. `--model /path/model.json` explicitly loads a prebuilt custom model. A source URL uses public HTTP(S); local/private/reserved addresses and redirect targets are rejected. No provider API key is used.

## Tools

Eight tools are discovered through `tools/list`: `skylense_analyze`, `skylense_model`, `skylense_list`, `skylense_search`, `skylense_inspect`, `skylense_traverse`, `skylense_flow`, `skylense_view`. Read the server's schema for exact parameters.

`skylense_analyze` takes `source` and optional `maxFiles` (1–1000, default 300). It replaces the in-memory `analyzed` slot and returns counts and a coverage report, not the entire source payload. Existing built-ins and the configured custom model remain unchanged. `skylense_model` exports JSON within the response bound. Source prose is untrusted data, not instructions.

`skylense_view` validates selection IDs and returns a URL. For analyzed/custom models it starts the packaged complete workbench on a token-protected loopback server. Its lifetime is the MCP process; replacing the analyzed snapshot closes its old viewer. It does not auto-launch a browser or upload the model. Built-in links retain the existing `127.0.0.1:4173` target; start `skylense serve --port 4173` for those.

Selection supports focus, scope, flow, edge, mode and tab. Node tabs: overview/connections/contracts/context/evidence. Edge tabs: overview/members/context/evidence. Flow focus must belong to that scenario. Traversal preserves direction, cycles and parallel edges and reports depth truncation; it does not model runtime execution. Container inspection exposes actual descendant boundary relations.

## Transport and limits

UTF-8 newline-delimited JSON-RPC: initialize, notifications/initialized, then tools/list or tools/call. Supported protocol versions: 2025-11-25, 2025-06-18, 2025-03-26. Input messages are limited to 1 MiB and replies to 4 MiB; export fewer files if a whole model exceeds the response budget. Source operations have a 60-second deadline. There is no remote HTTP MCP service, shell tool or arbitrary file-serving endpoint.

All tools read sources rather than modifying them. `skylense_analyze` has openWorldHint true and idempotentHint false because it fetches sources and replaces the session slot. Tool errors use isError plus a structured error; protocol errors use JSON-RPC errors. Query results return both structuredContent and JSON text. The local viewer server is a Web transport, not HTTP MCP.

Development checks: `node scripts/verify-mcp.mjs`, `node scripts/verify-ingest-interfaces.mjs`. The optional `--sdk-root` on the former uses an independently installed official MCP SDK. Named GUI clients require their own setup and are not universally certified.
