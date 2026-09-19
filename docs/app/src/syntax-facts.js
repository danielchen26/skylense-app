/* Source facts from actual Tree-sitter syntax nodes. No analyzed code is executed. */
(function (root) {
  "use strict";
  const ALIASES = { csharp: "c_sharp", shell: "bash", jsx: "javascript", typescriptreact: "tsx" };
  const JS = new Set(["javascript", "typescript", "tsx"]);
  const DECLARATIONS = {
    python: { class_definition: "class", function_definition: "function" },
    javascript: { class_declaration: "class", function_declaration: "function", generator_function_declaration: "function", method_definition: "function" },
    typescript: { class_declaration: "class", abstract_class_declaration: "class", function_declaration: "function", generator_function_declaration: "function", method_definition: "function", interface_declaration: "interface", method_signature: "function", abstract_method_signature: "function", enum_declaration: "enum", type_alias_declaration: "type", internal_module: "module" },
    go: { function_declaration: "function", method_declaration: "function", type_spec: "type" },
    rust: { function_item: "function", struct_item: "struct", enum_item: "enum", trait_item: "interface", mod_item: "module", type_item: "type", impl_item: "implementation" },
    java: { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "class", method_declaration: "function", constructor_declaration: "function", annotation_type_declaration: "interface" },
    c: { function_definition: "function", struct_specifier: "struct", union_specifier: "struct", enum_specifier: "enum", type_definition: "type" },
    cpp: { function_definition: "function", struct_specifier: "struct", union_specifier: "struct", enum_specifier: "enum", class_specifier: "class", namespace_definition: "module", type_definition: "type", alias_declaration: "type" },
    c_sharp: { class_declaration: "class", struct_declaration: "struct", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "class", namespace_declaration: "module", file_scoped_namespace_declaration: "module", method_declaration: "function", constructor_declaration: "function", local_function_statement: "function", delegate_declaration: "function" },
    ruby: { module: "module", class: "class", method: "function", singleton_method: "function" },
    php: { namespace_definition: "module", class_declaration: "class", interface_declaration: "interface", trait_declaration: "interface", enum_declaration: "enum", function_definition: "function", method_declaration: "function" },
    swift: { class_declaration: "class", protocol_declaration: "interface", function_declaration: "function", init_declaration: "function", typealias_declaration: "type" },
    kotlin: { class_declaration: "class", object_declaration: "module", function_declaration: "function", type_alias: "type" },
    scala: { class_definition: "class", object_definition: "module", trait_definition: "interface", function_definition: "function", function_declaration: "function", type_definition: "type" },
    lua: { function_definition_statement: "function", local_function_definition_statement: "function" },
    bash: { function_definition: "function" },
    julia: { module_definition: "module", struct_definition: "struct", abstract_definition: "abstract", primitive_definition: "primitive", function_definition: "function", macro_definition: "macro" },
  };
  const LIMITATIONS = [
    "Syntax trees identify source declarations and references; they do not establish runtime execution or a complete call graph.",
    "Computed imports, generated code, macro expansion, multiple dispatch and external dependency contents are not resolved.",
    "Malformed syntax is reported; recovered declarations may be partial and malformed reference nodes are excluded.",
  ];
  const children = node => node?.namedChildren || [];
  const field = (node, name) => node?.childForFieldName?.(name) || null;
  const first = (node, types) => children(node).find(item => types.includes(item.type));
  const sourceText = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : "";
  const lastLine = node => node.endPosition.row + (node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row ? 0 : 1);
  function descendants(node, predicate, max = 10000) {
    const queue = [node], result = []; let seen = 0;
    while (queue.length) {
      const item = queue.pop(); if (!item) continue;
      if (++seen > max) break;
      if (predicate(item)) result.push(item);
      else { const list = children(item); for (let i = list.length - 1; i >= 0; i--) queue.push(list[i]); }
    }
    return result;
  }
  function literal(node, text, language) {
    if (!node || node.hasError || node.isMissing) return null;
    const raw = sourceText(node, text);
    if (node.type === "word") return /[\s$`\\~*?{}\[\]]/.test(raw) ? null : raw;
    if (node.type === "system_lib_string") return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : null;
    if (language === "lua" && /^\[(=*)\[/.test(raw)) { const match = raw.match(/^\[(=*)\[([\s\S]*)\]\1\]$/); return match?.[2] ?? null; }
    if ((raw[0] !== '"' && raw[0] !== "'" && !(language === "go" && raw[0] === "`")) || raw.at(-1) !== raw[0]) return null;
    if (raw.startsWith(raw[0].repeat(3))) return null;
    if (descendants(node, item => /interpolation|substitution|expansion|escape_sequence/.test(item.type)).length) {
      // Accept only the small unambiguous literal escape subset below.
      if (descendants(node, item => /interpolation|substitution|expansion/.test(item.type)).length) return null;
    }
    const inner = raw.slice(1, -1);
    if (["julia", "bash", "php"].includes(language) && raw[0] === '"' && /(^|[^\\])[$`]/.test(inner)) return null;
    if (language === "go" && raw[0] === "`") return inner;
    if (/\\(?![\\"'$])/.test(inner)) return null;
    return inner.replace(/\\([\\"'$])/g, "$1");
  }
  function identifier(node, text) {
    if (!node || node.hasError || node.isMissing) return null;
    const value = sourceText(node, text).trim();
    return value && value.length <= 512 && !/[\r\n]/.test(value) ? value : null;
  }
  function cDeclarator(node) {
    let current = field(node, "declarator");
    for (let n = 0; current && n < 32; n++) {
      const child = field(current, "declarator");
      if (!child) return current;
      current = child;
    }
    return null;
  }
  function juliaHead(node) {
    let item = first(node, ["signature", "type_head"]) || (node.type === "assignment" ? children(node)[0] : node);
    for (let n = 0; item && n < 32; n++) {
      if (["signature", "type_head", "where_expression", "typed_expression", "parametrized_type_expression", "binary_expression"].includes(item.type)) item = children(item)[0];
      else return item;
    }
    return null;
  }
  function declaration(node, text, language) {
    let kind = DECLARATIONS[language]?.[node.type], nameNode = field(node, "name"), body = field(node, "body"), header = null;
    if (JS.has(language) && node.type === "variable_declarator" && ["arrow_function", "function_expression", "generator_function"].includes(field(node, "value")?.type)) {
      kind = "function"; body = field(field(node, "value"), "body");
    }
    if (language === "julia") {
      if (node.type === "assignment" && juliaHead(node)?.type === "call_expression") kind = "function";
      if (kind) {
        const head = juliaHead(node); nameNode = kind === "module" ? field(node, "name") : head?.type === "call_expression" ? children(head)[0] : head;
        if (kind === "function" && !["call_expression", "identifier", "operator", "field_expression"].includes(head?.type)) return null;
        header = first(node, ["signature", "type_head"]) || (node.type === "assignment" ? children(node)[0] : nameNode);
      }
    }
    if (!kind) return null;
    if (["c", "cpp"].includes(language)) {
      if (["struct_specifier", "class_specifier", "union_specifier", "enum_specifier"].includes(node.type) && !body) return null;
      nameNode ||= cDeclarator(node);
    }
    if (language === "rust" && node.type === "impl_item") nameNode = field(node, "type");
    if (language === "kotlin") nameNode ||= first(node, ["simple_identifier", "type_identifier"]);
    if (language === "swift" && node.type === "init_declaration") return { name: "init", kind, body, header, nameNode: null };
    let name = identifier(nameNode, text);
    if (language === "rust" && node.type === "impl_item" && name) name = "impl " + name;
    if (language === "julia" && name) name = name.replace(/\.\:\(([^()]+)\)/g, ".$1");
    if (!name) return null;
    return { name, kind, body, header, nameNode };
  }
  function juliaInclude(node, text) {
    const name = identifier(children(node)[0], text), args = children(first(node, ["argument_list"]));
    if (name !== "include" || args.length !== 1) return null;
    const direct = literal(args[0], text, "julia"); if (direct !== null) return direct;
    if (args[0].type !== "call_expression" || identifier(children(args[0])[0], text) !== "joinpath") return null;
    const parts = children(first(args[0], ["argument_list"]));
    if (sourceText(parts.shift(), text) !== "@__DIR__" || !parts.length) return null;
    const values = parts.map(item => literal(item, text, "julia"));
    return values.every(value => value && !/^[\\/]/.test(value)) ? values.join("/") : null;
  }
  function requireShadowScopes(tree, text) {
    const scopes = new Set(), functions = new Set(["function_declaration", "function_expression", "generator_function", "generator_function_declaration", "arrow_function", "method_definition"]);
    const blocks = new Set(["program", "statement_block", "for_statement", "for_in_statement", "switch_body", "catch_clause"]);
    const nearest = (node, functionOnly = false) => { let item = node; while (item) { if (functions.has(item.type) || item.type === "program" || !functionOnly && blocks.has(item.type)) return item; item = item.parent; } return tree.rootNode; };
    const bindsRequire = node => {
      if (!node) return false;
      if (["identifier", "shorthand_property_identifier_pattern"].includes(node.type)) return sourceText(node, text) === "require";
      if (["assignment_pattern", "object_assignment_pattern"].includes(node.type)) return bindsRequire(field(node, "left"));
      if (node.type === "pair_pattern") return bindsRequire(field(node, "value"));
      if (["required_parameter", "optional_parameter"].includes(node.type)) return bindsRequire(field(node, "pattern"));
      if (["formal_parameters", "object_pattern", "array_pattern", "rest_pattern"].includes(node.type)) return children(node).some(bindsRequire);
      return false;
    };
    const pending = [tree.rootNode];
    while (pending.length) {
      const node = pending.pop();
      if (functions.has(node.type) && (bindsRequire(field(node, "parameters") || field(node, "parameter")) || ["function_expression", "generator_function"].includes(node.type) && bindsRequire(field(node, "name")))) scopes.add(node.id);
      if (node.type === "catch_clause" && bindsRequire(field(node, "parameter"))) scopes.add(node.id);
      if (node.type === "variable_declarator" && bindsRequire(field(node, "name"))) scopes.add(nearest(node.parent, node.parent?.type === "variable_declaration").id);
      if (["function_declaration", "generator_function_declaration", "class_declaration"].includes(node.type) && bindsRequire(field(node, "name"))) scopes.add(nearest(node.parent).id);
      if (["assignment_expression", "augmented_assignment_expression"].includes(node.type) && bindsRequire(field(node, "left"))) scopes.add(nearest(node.parent, true).id);
      if (node.type === "import_statement") {
        const clause = first(node, ["import_clause"]);
        for (const part of children(clause)) {
          if (part.type === "identifier" && bindsRequire(part)) scopes.add(tree.rootNode.id);
          if (part.type === "namespace_import" && bindsRequire(children(part).at(-1))) scopes.add(tree.rootNode.id);
          if (part.type === "named_imports" && children(part).some(item => bindsRequire(field(item, "alias") || field(item, "name")))) scopes.add(tree.rootNode.id);
        }
      }
      if (node.type === "with_statement") scopes.add(node.id);
      pending.push(...children(node));
    }
    return node => { for (let item = node; item; item = item.parent) if (scopes.has(item.id)) return true; return false; };
  }
  function extract(tree, source, suppliedLanguage, path = "") {
    const text = String(source ?? ""), language = ALIASES[suppliedLanguage] || suppliedLanguage;
    const grammarLanguage = language === "tsx" ? "typescript" : language;
    if (!tree?.rootNode || !Number.isInteger(tree.rootNode.startIndex)) throw new Error("A parsed Tree-sitter tree is required.");
    const requireShadowed = JS.has(language) ? requireShadowScopes(tree, text) : () => false;
    const symbols = [], imports = [], calls = [], diagnostics = [], embedded = [], relationships = [], seenReferences = new Set(), seenNodes = new Set(), headers = new Map();
    const julia = { bindings: [], exports: [], dynamicScopes: [] }, moduleBindings = new Set(); let moduleBindingsDynamic = false;
    const stack = [{ node: tree.rootNode, owner: null, suppressed: false, conditional: false }]; let visited = 0;
    function reference(node, specifier, form, extra = {}) {
      if (!specifier || node.hasError || /[\u0000-\u001f]/.test(specifier)) return;
      const key = `${node.startIndex}:${form}:${specifier}`; if (seenReferences.has(key)) return; seenReferences.add(key);
      imports.push({ specifier, form, line: node.startPosition.row + 1, endLine: lastLine(node), column: node.startPosition.column, startIndex: node.startIndex, endIndex: node.endIndex, ...extra });
    }
    function importFacts(node, owner, conditional) {
      if (node.hasError) return;
      const type = node.type;
      if (language === "python" && ["import_statement", "import_from_statement"].includes(type)) {
        if (type === "import_from_statement") {
          const module = sourceText(field(node, "module_name"), text), imported = children(node).filter(child => child.id !== field(node, "module_name")?.id);
          const names = imported.map(child => sourceText(field(child, "name") || child, text)).filter(Boolean);
          reference(node, module, "python-from", { names });
        } else for (const child of children(node)) reference(node, sourceText(field(child, "name") || child, text), "python-import", { names: [] });
      }
      if (JS.has(language)) {
        if (["import_statement", "export_statement"].includes(type)) {
          const bindings = [], clause = first(node, ["import_clause"]), typeOnly = /^import\s+type\b/.test(sourceText(node, text));
          if (clause) for (const child of children(clause)) {
            if (child.type === "identifier") bindings.push({ name: "default", alias: sourceText(child, text), kind: "default", typeOnly });
            else if (child.type === "namespace_import") bindings.push({ name: "*", alias: sourceText(children(child).at(-1), text), kind: "namespace", typeOnly });
            else if (child.type === "named_imports") for (const spec of children(child)) {
              const name = sourceText(field(spec, "name"), text), alias = sourceText(field(spec, "alias"), text) || name;
              if (name && alias) bindings.push({ name, alias, kind: "named", typeOnly: typeOnly || /^type\s/.test(sourceText(spec, text)) });
            }
          }
          reference(node, literal(field(node, "source"), text, language), "js-import", { bindings, owner: null, reexport: type === "export_statement" });
        }
        if (type === "call_expression" && ["require", "import"].includes(sourceText(field(node, "function"), text))) {
          const callee = sourceText(field(node, "function"), text), args = children(field(node, "arguments"));
          if (args.length === 1 && !(callee === "require" && requireShadowed(node))) reference(node, literal(args[0], text, language), "js-import");
        }
      }
      if (language === "julia") {
        if (type === "call_expression") reference(node, juliaInclude(node, text), "julia-include", { owner, conditional });
        if (["using_statement", "import_statement"].includes(type)) for (const child of children(node)) {
          const target = ["selected_import", "import_alias"].includes(child.type) ? children(child)[0] : child;
          const value = sourceText(target, text).trim();
          const bindings = child.type === "selected_import" ? children(child).slice(1).map(item => {
            const parts = item.type === "import_alias" ? children(item) : [item];
            return { name: sourceText(parts[0], text), alias: sourceText(parts.at(-1), text) };
          }) : [];
          if (/^\.*[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(value)) reference(node, value, "julia-module", { owner, conditional, bindings, ...(child.type === "import_alias" ? { moduleAlias: sourceText(children(child).at(-1), text) } : {}), mode: type === "using_statement" ? "using" : "import" });
        }
      }
      if (language === "go" && type === "import_spec") reference(node, literal(field(node, "path"), text, language), "go-import");
      if (language === "rust") {
        if (type === "mod_item" && !field(node, "body")) reference(node, sourceText(field(node, "name"), text), "rust-mod");
        if (type === "use_declaration") {
          const argument = field(node, "argument"), value = sourceText(argument, text);
          if (/^(?:[\p{L}_][\p{L}\p{N}_]*::)*[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) reference(node, value, "rust-use");
        }
      }
      if (["c", "cpp"].includes(language) && type === "preproc_include") { const target = field(node, "path"); reference(node, literal(target, text, language), "c-include", { system: target?.type === "system_lib_string" }); }
      if (language === "java" && type === "import_declaration") reference(node, sourceText(children(node).find(child => /identifier/.test(child.type)), text), "java-import");
      if (language === "c_sharp" && type === "using_directive") reference(node, sourceText(children(node).at(-1), text), "csharp-using");
      if (language === "ruby" && type === "call" && !field(node, "receiver")) {
        const name = sourceText(field(node, "method"), text), args = children(field(node, "arguments"));
        if (["require", "require_relative"].includes(name) && args.length === 1) reference(node, literal(args[0], text, language), name === "require_relative" ? "ruby-relative" : "ruby-require");
      }
      if (language === "php") {
        if (["include_expression", "include_once_expression", "require_expression", "require_once_expression"].includes(type)) reference(node, literal(children(node)[0], text, language), "php-include");
        if (type === "namespace_use_clause") reference(node, sourceText(children(node)[0], text), "php-use");
      }
      if (language === "swift" && type === "import_declaration") reference(node, sourceText(first(node, ["identifier"]), text), "swift-import");
      if (language === "kotlin" && type === "import_header") reference(node, sourceText(first(node, ["identifier"]), text), "kotlin-import");
      if (language === "scala" && type === "import_declaration") reference(node, sourceText(field(node, "path"), text), "scala-import");
      if (language === "lua" && type === "call" && sourceText(field(node, "function"), text) === "require") {
        let args = children(field(node, "arguments")); if (args.length === 1 && args[0].type === "expression_list") args = children(args[0]);
        if (args.length === 1 && args[0].type === "string") reference(node, literal(args[0], text, language), "lua-require");
      }
      if (language === "bash" && type === "command" && ["source", "."].includes(sourceText(field(node, "name"), text))) reference(node, literal(field(node, "argument"), text, language), "shell-source", { static: true });
      if (language === "css" && type === "import_statement") reference(node, literal(first(node, ["string_value"]), text, language), "css-import");
      if (["html", "vue"].includes(language) && ["start_tag", "self_closing_tag"].includes(type)) {
        const tag = sourceText(first(node, ["tag_name"]), text).toLowerCase(), attrs = new Map();
        for (const attribute of children(node).filter(child => child.type === "attribute")) {
          const key = sourceText(first(attribute, ["attribute_name"]), text).toLowerCase(), valueNode = first(attribute, ["attribute_value", "quoted_attribute_value"]);
          const value = valueNode?.type === "quoted_attribute_value" ? sourceText(first(valueNode, ["attribute_value"]), text) : sourceText(valueNode, text);
          if (key && !attrs.has(key)) attrs.set(key, value);
        }
        if (tag === "script") reference(node, attrs.get("src"), "html-script");
        if (tag === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(attrs.get("rel") || "")) reference(node, attrs.get("href"), "html-stylesheet");
        if (["a", "area"].includes(tag)) reference(node, attrs.get("href"), "html-link");
        if (tag === "script" && !attrs.get("src")) {
          const body = first(node.parent, ["raw_text"]), requested = (attrs.get("lang") || "").toLowerCase(), mime = (attrs.get("type") || "").toLowerCase();
          if (body && (!mime || ["module", "text/javascript", "application/javascript", "text/typescript"].includes(mime)) && !attrs.has(":src") && !attrs.has("v-bind:src")) embedded.push({ language: ["ts", "typescript"].includes(requested) || mime === "text/typescript" ? "typescript" : "javascript", text: sourceText(body, text), lineOffset: body.startPosition.row, startColumn: body.startPosition.column, startIndex: body.startIndex });
        }
        if (tag === "style" && !attrs.get("src") && (!attrs.get("lang") || attrs.get("lang").toLowerCase() === "css")) { const body = first(node.parent, ["raw_text"]); if (body) embedded.push({ language: "css", text: sourceText(body, text), lineOffset: body.startPosition.row, startColumn: body.startPosition.column, startIndex: body.startIndex }); }
      }
    }
    while (stack.length) {
      const { node, owner, suppressed, conditional } = stack.pop(); if (!node) continue;
      if (++visited > 2000000) throw new Error(`Syntax traversal safety ceiling reached for ${path || "source"}; no complete result was produced.`);
      if ((node.isError || node.isMissing) && diagnostics.length < 100) diagnostics.push({ kind: node.isMissing ? "missing-syntax" : "parse-error", line: node.startPosition.row + 1, endLine: node.endPosition.row + 1, nodeType: node.type });
      if (node.hasError && diagnostics.length < 100) for (const child of node.children || []) if (!child.isNamed && child.isMissing && diagnostics.length < 100) diagnostics.push({ kind: "missing-syntax", line: child.startPosition.row + 1, endLine: lastLine(child), nodeType: child.type });
      const suppress = suppressed || language === "julia" && ["quote_statement", "quote_expression"].includes(node.type);
      if (suppress) continue;
      let currentOwner = owner;
      let declared = declaration(node, text, grammarLanguage);
      if (language === "css" && node.type === "rule_set") { const selector = first(node, ["selectors"]); if (selector) declared = { name: sourceText(selector, text).slice(0, 512), kind: "section", header: selector, body: field(node, "body") }; }
      if (language === "json" && node.type === "pair" && ["object", "array"].includes(field(node, "value")?.type)) { const name = literal(field(node, "key"), text, "json"); if (name) declared = { name, kind: "section", header: field(node, "key"), body: field(node, "value") }; }
      if (["html", "vue"].includes(language) && node.type === "element") {
        const tag = first(node, ["start_tag"]), name = sourceText(first(tag, ["tag_name"]), text).toLowerCase();
        if (/^h[1-6]$/.test(name)) {
          const label = descendants(node, child => child.type === "text").map(child => sourceText(child, text)).join(" ").trim();
          if (label) declared = { name: label.slice(0, 512), kind: "section", body: null, header: tag };
        }
      }
      if (declared) {
        const key = `${node.startIndex}:${declared.name}`;
        if (!seenNodes.has(key)) {
          seenNodes.add(key);
          const index = symbols.length, line = node.startPosition.row + 1;
          let endLine = declared.header ? lastLine(declared.header) : declared.body ? declared.body.startPosition.row + (["python", "ruby", "lua"].includes(language) ? 0 : 1) : line;
          endLine = Math.max(line, Math.min(endLine, lastLine(node)));
          const anchor = declared.nameNode || node;
          symbols.push({ index, name: declared.name, qualifiedName: owner === null ? declared.name : `${symbols[owner].qualifiedName}.${declared.name}`, kind: declared.kind, line, endLine, bodyEndLine: lastLine(node), parent: owner, column: node.startPosition.column, nameLine: anchor.startPosition.row + 1, nameColumn: anchor.startPosition.column, nameStartIndex: anchor.startIndex, startIndex: node.startIndex, endIndex: node.endIndex, ...(declared.body ? { bodyStartIndex: declared.body.startIndex, bodyEndIndex: declared.body.endIndex } : {}), evidenceStatus: "syntax-tree", nodeType: node.type, conditional }); currentOwner = index;
          if (language === "python" && owner === null) moduleBindings.add(declared.name);
          if (declared.header) headers.set(index, [declared.header.startIndex, declared.header.endIndex]);
          let bases = [];
          if (language === "python" && node.type === "class_definition") bases = children(field(node, "superclasses"));
          if (JS.has(language)) { const heritage = first(node, ["class_heritage", "extends_type_clause"]); if (heritage) bases = descendants(heritage, child => ["identifier", "type_identifier", "member_expression", "nested_type_identifier"].includes(child.type)); }
          for (const base of bases) {
            const name = identifier(base, text); if (name && /^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.test(name)) relationships.push({ form: "inherits", name, owner: index, line: base.startPosition.row + 1, endLine: lastLine(base), resolution: { kind: "unresolved", reason: "Base declaration requires lexical binding resolution" } });
          }
        }
      }
      importFacts(node, owner, conditional);
      if (language === "python" && owner === null) {
        const bindingNames = target => {
          if (!target) return [];
          if (target.type === "identifier") return [sourceText(target, text)];
          if (["tuple_pattern", "list_pattern", "pattern_list", "tuple", "list"].includes(target.type)) return children(target).flatMap(bindingNames);
          if (["list_splat_pattern", "dictionary_splat_pattern"].includes(target.type)) return bindingNames(children(target)[0]);
          return [];
        };
        if (["assignment", "augmented_assignment", "named_expression"].includes(node.type)) for (const name of bindingNames(field(node, "left") || field(node, "name"))) moduleBindings.add(name);
        if (["import_statement", "import_from_statement"].includes(node.type)) for (const item of children(node)) {
          if (item.id === field(node, "module_name")?.id) continue;
          if (item.type === "wildcard_import") { moduleBindingsDynamic = true; continue; }
          const name = sourceText(field(item, "alias") || field(item, "name") || item, text);
          if (name) moduleBindings.add(node.type === "import_statement" && !field(item, "alias") ? name.split(".")[0] : name);
        }
        if (node.type === "call" && ["exec", "eval", "globals", "locals"].includes(sourceText(field(node, "function"), text))) moduleBindingsDynamic = true;
      }
      if (language === "julia") {
        const bindingNames = target => {
          if (!target) return [];
          if (target.type === "identifier") return [sourceText(target, text)];
          if (["typed_expression", "named_argument", "optional_parameter", "splat_expression"].includes(target.type)) return bindingNames(children(target)[0]);
          if (["tuple_expression", "open_tuple", "argument_list"].includes(target.type)) return children(target).flatMap(bindingNames);
          return [];
        };
        const bind = (target, kind, scope = owner) => { for (const name of bindingNames(target)) julia.bindings.push({ name, owner: scope, kind, line: target.startPosition.row + 1 }); };
        if (declared?.kind === "function") { const head = juliaHead(node); if (head?.type === "call_expression") bind(first(head, ["argument_list"]), "parameter", currentOwner); }
        if (declared && declared.header) {
          const typeParameters = descendants(declared.header, item => item.type === "where_expression");
          for (const expression of typeParameters) for (const parameter of children(expression).slice(1)) {
            const parts = parameter.type === "curly_expression" ? children(parameter) : [parameter];
            for (const part of parts) bind(part.type === "binary_expression" ? children(part)[0] : part, "type-parameter", currentOwner);
          }
        }
        if (node.type === "function_definition" && !declared) { const head = juliaHead(node); if (head?.type === "argument_list") bind(head, "anonymous-parameter"); }
        if (node.type === "arrow_function_expression") bind(children(node)[0], "anonymous-parameter");
        if (node.type === "assignment" && !declared) bind(children(node)[0], "assignment");
        if (["compound_assignment_expression", "compound_assignment"].includes(node.type)) bind(children(node)[0], "assignment");
        if (["for_binding", "let_binding"].includes(node.type)) bind(children(node)[0], "local-scope");
        if (node.type === "let_statement" && children(node)[0]?.type === "identifier") bind(children(node)[0], "local-scope");
        if (node.type === "catch_clause" && children(node)[0]?.type === "identifier") bind(children(node)[0], "local-scope");
        if (node.type === "do_clause") bind(first(node, ["argument_list"]), "local-scope");
        if (["global_statement", "local_statement", "const_statement"].includes(node.type)) for (const child of children(node)) bind(child, node.type);
        if (node.type === "export_statement") julia.exports.push({ owner, conditional, names: children(node).filter(item => item.type === "identifier").map(item => sourceText(item, text)) });
        if (node.type === "call_expression" && ["eval", "Core.eval", "Base.eval"].includes(sourceText(children(node)[0], text))) julia.dynamicScopes.push(owner);
        if (node.type === "call_expression" && sourceText(children(node)[0], text) === "include" && juliaInclude(node, text) === null) julia.dynamicScopes.push(owner);
        if (node.type === "macrocall_expression" && /(?:^|\.)@eval\b/.test(sourceText(children(node)[0], text))) julia.dynamicScopes.push(owner);
      }
      const callable = ["call_expression", "call", "method_invocation", "invocation_expression"].includes(node.type);
      if (callable && !node.hasError) {
        const target = field(node, "function") || (language === "julia" ? children(node)[0] : null) || field(node, "name") || field(node, "method");
        const name = identifier(target, text);
        const header = headers.get(owner), inSignature = language === "julia" && header && node.startIndex >= header[0] && node.endIndex <= header[1];
        if (name && !inSignature && !["include", "require", "import", "joinpath"].includes(name)) calls.push({ name, owner, line: node.startPosition.row + 1, endLine: lastLine(node), column: node.startPosition.column, startIndex: node.startIndex, endIndex: node.endIndex, calleeKind: target?.type, conditional, resolution: { kind: "unresolved", reason: "Syntax call site; dispatch and binding require semantic resolution" }, evidenceStatus: "syntax-tree" });
      }
      const list = children(node);
      for (let i = list.length - 1; i >= 0; i--) stack.push({ node: list[i], owner: currentOwner, suppressed: language === "julia" && node.type === "macro_definition", conditional: conditional || ["if_statement", "for_statement", "while_statement", "try_statement", "macrocall_expression"].includes(node.type) });
    }
    const structure = { symbols, calls, callableExports: {} };
    // The existing Python binder is deliberately narrower than the grammar.
    // Remap only declarations independently identified by both mechanisms.
    if (language === "python" && root.SkylensePythonStructure) {
      const lexical = root.SkylensePythonStructure.analyze(text), mapping = new Map(), declarationsByAnchor = new Map();
      for (const symbol of symbols) { const key = `${symbol.line}:${symbol.qualifiedName}:${symbol.name}`, matches = declarationsByAnchor.get(key) || []; matches.push(symbol); declarationsByAnchor.set(key, matches); }
      for (const old of lexical.symbols) {
        const matches = declarationsByAnchor.get(`${old.line}:${old.qualifiedName}:${old.name}`) || [];
        if (matches.length === 1) mapping.set(old.index, matches[0].index);
      }
      if (!lexical.truncated) {
        const syntaxCalls = new Map();
        for (const call of calls) {
          const key = `${call.owner}:${call.line}:${call.name}`, matches = syntaxCalls.get(key) || []; matches.push(call); syntaxCalls.set(key, matches);
        }
        for (const call of lexical.calls) {
          const owner = call.owner === null ? null : mapping.get(call.owner); if (owner === undefined) continue;
          const syntaxCall = syntaxCalls.get(`${owner}:${call.line}:${call.name}`)?.shift(); if (!syntaxCall) continue;
          const resolution = call.resolution.kind === "local" && mapping.has(call.resolution.symbol) ? { ...call.resolution, symbol: mapping.get(call.resolution.symbol) } : call.resolution.kind === "import" ? call.resolution : { kind: "unresolved", reason: "Binding or syntax declaration is ambiguous" };
          syntaxCall.resolution = resolution;
        }
        for (const [name, index] of Object.entries(lexical.callableExports)) if (mapping.has(index)) structure.callableExports[name] = mapping.get(index);
      }
    }
    if (tree.rootNode.hasError && !diagnostics.length) diagnostics.push({ kind: "parse-error", line: 1, endLine: lastLine(tree.rootNode), nodeType: tree.rootNode.type });
    return { symbols, imports, structure, embedded, relationships, ...(language === "julia" ? { julia } : {}), ...(language === "python" ? { moduleBindings: [...moduleBindings], moduleBindingsDynamic } : {}), parser: { engine: "tree-sitter", language, grammar: language }, status: tree.rootNode.hasError ? "partial" : "analyzed", diagnostics, truncated: false, limitations: [...LIMITATIONS] };
  }
  root.SkylenseSyntaxFacts = Object.freeze({ extract, languages: Object.freeze([...Object.keys(DECLARATIONS), "tsx", "html", "css", "vue", "json", "yaml", "toml"]) });
})(typeof window !== "undefined" ? window : globalThis);
