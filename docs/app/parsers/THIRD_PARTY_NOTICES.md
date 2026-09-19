# Third-party parser notices

Skylense redistributes the following Tree-sitter runtime and language parser binaries. These components retain their upstream licenses. Skylense application licensing does not replace or restrict the rights granted by these third-party licenses.

## Runtime and binary packages

- **web-tree-sitter 0.25.10**: [Tree-sitter](https://github.com/tree-sitter/tree-sitter), [MIT license](licenses/web-tree-sitter.txt). `tree-sitter.mjs` is the publisher's `tree-sitter.js` renamed without byte changes; `tree-sitter.wasm` is copied unchanged.
- **tree-sitter-wasms 0.1.13**: [binary packager](https://github.com/Gregoor/tree-sitter-wasms), [Unlicense](licenses/tree-sitter-wasms.txt). This package supplies 22 bundled grammar binaries. Its package license does not replace the individual grammar licenses below.
- **@lumis-sh/wasm-julia 0.26.2** and **@lumis-sh/wasm-yaml 0.26.2**: [Lumis binary packages](https://github.com/leandrocp/lumis). Only the grammar WASM binaries are redistributed; upstream parser licenses are listed below.

## Original grammars

Each local license file preserves its original copyright and permission notice. TypeScript and TSX share the same upstream project and license.

| Grammar | Upstream source version / revision | License |
| --- | --- | --- |
| python | [tree-sitter-python 0.21.0 / 0f9047c857ed](https://github.com/tree-sitter/tree-sitter-python/tree/0f9047c857ed0990931b1f899c7d3bf403703147) | [MIT](licenses/tree-sitter-python.txt) |
| javascript | [tree-sitter-javascript 0.20.4 / de1e682289a4](https://github.com/tree-sitter/tree-sitter-javascript/tree/de1e682289a417354df5b4437a3e4f92e0722a0f) | [MIT](licenses/tree-sitter-javascript.txt) |
| typescript | [tree-sitter-typescript 0.20.5 / 7db8390a16a2](https://github.com/tree-sitter/tree-sitter-typescript/tree/7db8390a16a2cae317f4f4423a7b642cd4cad8c9) | [MIT](licenses/tree-sitter-typescript.txt) |
| tsx | [tree-sitter-typescript 0.20.5 / 7db8390a16a2](https://github.com/tree-sitter/tree-sitter-typescript/tree/7db8390a16a2cae317f4f4423a7b642cd4cad8c9) | [MIT](licenses/tree-sitter-typescript.txt) |
| go | [tree-sitter-go 0.20.0 / bbaa67a180cf](https://github.com/tree-sitter/tree-sitter-go/tree/bbaa67a180cfe0c943e50c55130918be8efb20bd) | [MIT](licenses/tree-sitter-go.txt) |
| rust | [tree-sitter-rust 0.20.4 / afb6000a71fb](https://github.com/tree-sitter/tree-sitter-rust/tree/afb6000a71fb9dff3f47f90d412ec080ae12bbb4) | [MIT](licenses/tree-sitter-rust.txt) |
| java | [tree-sitter-java 0.20.2 / 2b57cd9541f9](https://github.com/tree-sitter/tree-sitter-java/tree/2b57cd9541f9fd3a89207d054ce8fbe72657c444) | [MIT](licenses/tree-sitter-java.txt) |
| c | [tree-sitter-c 0.20.8 / 25ca2718aaca](https://github.com/tree-sitter/tree-sitter-c/tree/25ca2718aacaf0feda8b0709471332f303a0cef5) | [MIT](licenses/tree-sitter-c.txt) |
| cpp | [tree-sitter-cpp 0.20.5 / e0c1678a7873](https://github.com/tree-sitter/tree-sitter-cpp/tree/e0c1678a78731e78655b7d953efb4daecf58be46) | [MIT](licenses/tree-sitter-cpp.txt) |
| c_sharp | [tree-sitter-c-sharp 0.20.0 / 7a47daeaf0d4](https://github.com/tree-sitter/tree-sitter-c-sharp/tree/7a47daeaf0d410dd1a91c97b274bb7276dd96605) | [MIT](licenses/tree-sitter-c-sharp.txt) |
| ruby | [tree-sitter-ruby 0.20.1 / 7a010836b743](https://github.com/tree-sitter/tree-sitter-ruby/tree/7a010836b74351855148818d5cb8170dc4df8e6a) | [MIT](licenses/tree-sitter-ruby.txt) |
| php | [tree-sitter-php 0.22.8 / c07d69739ba7](https://github.com/tree-sitter/tree-sitter-php/tree/c07d69739ba71b5a449bdbb7735991f8aabf8546) | [MIT](licenses/tree-sitter-php.txt) |
| swift | [tree-sitter-swift 0.4.3 / 47abc888b965](https://github.com/alex-pinkus/tree-sitter-swift/tree/47abc888b965c84932d5709008fb370464e812eb) | [MIT](licenses/tree-sitter-swift.txt) |
| kotlin | [tree-sitter-kotlin 0.3.8 / e1a2d5ad1f61](https://github.com/fwcd/tree-sitter-kotlin/tree/e1a2d5ad1f61f5740677183cd4125bb071cd2f30) | [MIT](licenses/tree-sitter-kotlin.txt) |
| bash | [tree-sitter-bash 0.20.5 / d1a1a3fe7189](https://github.com/tree-sitter/tree-sitter-bash/tree/d1a1a3fe7189fdab5bd29a54d1df4a5873db5cb1) | [MIT](licenses/tree-sitter-bash.txt) |
| lua | [tree-sitter-lua 2.1.3 / 6b02dfd7f07f](https://github.com/Azganoth/tree-sitter-lua/tree/6b02dfd7f07f36c223270e97eb0adf84e15a4cef) | [MIT](licenses/tree-sitter-lua.txt) |
| scala | [tree-sitter-scala 0.19.0 / 262797b1dfe0](https://github.com/tree-sitter/tree-sitter-scala/tree/262797b1dfe0303818c2418c0a88f6be65f37245) | [MIT](licenses/tree-sitter-scala.txt) |
| html | [tree-sitter-html 0.20.4 / 3713d4004c22](https://github.com/tree-sitter/tree-sitter-html/tree/3713d4004c2259f7658eaad367dbad1a3989429d) | [MIT](licenses/tree-sitter-html.txt) |
| css | [tree-sitter-css 0.20.0 / 98c7b3dceb24](https://github.com/tree-sitter/tree-sitter-css/tree/98c7b3dceb24f1ee17f1322f3947e55638251c37) | [MIT](licenses/tree-sitter-css.txt) |
| json | [tree-sitter-json 0.20.2 / c5a9a9af069d](https://github.com/tree-sitter/tree-sitter-json/tree/c5a9a9af069de3fe0ef5fa2fa001b6a2e44d75b2) | [MIT](licenses/tree-sitter-json.txt) |
| yaml | [tree-sitter-yaml 0.7.2 / f1790f0a8246](https://github.com/ericmj/tree-sitter-yaml/tree/f1790f0a8246a650466bfd342b1c2c373c14b76c) | [MIT](licenses/tree-sitter-yaml.txt) |
| toml | [tree-sitter-toml 0.5.1 / 474fbbec27e2](https://github.com/ikatyang/tree-sitter-toml/tree/474fbbec27e27d76b45aeaf9191e8acb13a699e2) | [MIT](licenses/tree-sitter-toml.txt) |
| vue | [tree-sitter-vue 7e48557b903a](https://github.com/tree-sitter-grammars/tree-sitter-vue/tree/7e48557b903a9db9c38cea3b7839ef7e1f36c693) | [MIT](licenses/tree-sitter-vue.txt) |
| julia | [tree-sitter-julia 0.23.1 / a8e1262997d5](https://github.com/tree-sitter/tree-sitter-julia/tree/a8e1262997d5a45520a06cbe1b86c0737d507054) | [MIT](licenses/tree-sitter-julia.txt) |

## Provenance and verification boundaries

`manifest.json` records SHA-256 hashes for every shipped runtime/WASM asset and every license file, exact binary package versions and integrity metadata, original grammar revisions, and primary license URLs. The 22 tree-sitter-wasms grammar mappings come from the lockfile at the package's npm `gitHead`; Julia and YAML mappings come from their version-pinned publisher README files.

The packaged files were checked against their corresponding extracted publisher packages. These checks identify distributed bytes and publisher-declared source provenance; they are not an independent reproducible build of every binary.

A basic syntax fixture is parsed by each grammar using the bundled runtime. That check confirms load/parse compatibility for those fixtures, not complete language-version coverage, type resolution, or runtime behavior. The older YAML artifact from tree-sitter-wasms failed this check and is not shipped; the bundled YAML artifact is the compatible Lumis build.

## TypeScript semantic resolver

The bundled unmodified `typescript.js` is from the published `typescript@5.9.3` package, copyright Microsoft Corporation, licensed under Apache-2.0. It is used for static JavaScript/TypeScript symbol binding. The full license is preserved in `licenses/typescript-Apache-2.0.txt`. Upstream source: https://github.com/microsoft/TypeScript/tree/v5.9.3 . Skylense does not execute analyzed project code.
