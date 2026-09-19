# Connect Skylense to your coding agent

Skylense supplies a local read-only **stdio MCP server**. It queries the same curated architecture models as the Web app. No API key is needed by Skylense itself; your agent client has its own requirements and data policies.

## Install and connect

1. Download `skylense-0.2.0.tgz` from the [public release](https://github.com/danielchen26/skylense-app/releases/tag/v0.2.0).
2. With Node.js 22+, install the local file:

   ```sh
   npm install -g /absolute/path/to/skylense-0.2.0.tgz
   skylense config
   ```

3. Copy the printed `command` and `args` into your client's MCP configuration, then enable the server using that client's instructions. Configuration wrappers differ between clients. Skylense does not change client settings automatically.

If global installation is unavailable, extract the TGZ to a folder and use `node /absolute/path/package/bin/skylense.mjs config` instead. Do not use `sudo` just to bypass a local npm permission problem.

## A useful first prompt

> Use Skylense to list the available maps. In autoresearch, find the training loop, inspect its parent and source evidence, then follow its downstream connections two hops. Distinguish the map's explicit edges from your interpretation.

Tools: `skylense_list`, `skylense_search`, `skylense_inspect`, `skylense_traverse`, `skylense_flow`, `skylense_view`. They do not execute source projects or run shell commands. Returned source and documentation excerpts are quoted data, not instructions for the agent to follow.

## Use an exported model

```sh
skylense config --model /absolute/path/model.json
```

The selected file becomes the `custom` model for that process. It must be a valid Skylense JSON model. This does not scan an arbitrary source directory or synchronize with a browser import. Restart the MCP process after changing the model file.

## Open a generated local Web link

`skylense_view` returns a URL at `http://127.0.0.1:4173/index.html`. To use it, download and extract the separate Web ZIP and serve its `skylense-web` folder on that address. For example, if you have Python 3 installed:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory /absolute/path/skylense-web
```

Keep that server running while following the generated link. Opening `standalone.html` directly is enough for ordinary offline use, but it does not create a server for MCP links. The hosted public app is also separate from your local process.

Custom model links are intentionally unsupported: import the same JSON through the browser to view it there. Neither URL generation nor a client connection uploads a model automatically. Query results are nevertheless shared with the connected agent, whose provider policies apply.

[Terminal guide](TERMINAL.md) · [Data boundaries](../PRIVACY.md)
