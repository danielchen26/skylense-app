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
    "Function inputs and outputs are copied from source signatures and explicit return annotations when present. Missing annotations, unsupported forms and partial extraction are recorded separately in sourceContract and are not inferred from names or return statements.",
  ];
  const children = node => node?.namedChildren || [];
  const field = (node, name) => node?.childForFieldName?.(name) || null;
  const first = (node, types) => children(node).find(item => types.includes(item.type));
  const sourceText = (node, text) => node ? text.slice(node.startIndex, node.endIndex) : "";
  const lastLine = node => node.endPosition.row + (node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row ? 0 : 1);
  function childFields(node) {
    const list = [];
    if (!node) return list;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child || !child.isNamed) continue;
      list.push({ child, field: node.fieldNameForChild(i) || "" });
    }
    return list;
  }
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
  function functionNode(node, language) {
    if (JS.has(language) && node.type === "variable_declarator") return field(node, "value") || node;
    return node;
  }
  function skipTrivia(items) {
    return items.filter(item => item && !item.hasError && !item.isMissing && !/comment/.test(item.type));
  }
  function pythonDocstring(file, text, body) {
    const S = root.SkylenseSourceContracts;
    if (!body) return null;
    const statement = children(body).find(item => item.type !== "comment") || null;
    if (!statement) return null;
    const inner = statement.type === "expression_statement" ? children(statement)[0] : statement;
    if (!inner) return null;
    const strings = inner.type === "concatenated_string" ? children(inner) : inner.type === "string" ? [inner] : [];
    if (!strings.length) return null;
    for (const item of strings) {
      const start = sourceText(first(item, ["string_start"]) || item, text);
      if (/^[bBfF]/.test(start) || /[fF]/.test(start.replace(/^[rRuUbB]*/, ""))) return null;
      if (!/^([rRuU]{0,2})("""|'''|"|')/.test(start) && start !== '"""' && start !== "'''" && start !== '"' && start !== "'") return null;
    }
    const raw = S.pieceFromNode(file, text, inner.type === "concatenated_string" ? inner : strings[0]);
    const bodyText = raw.text.replace(/^([rRuU]{0,2})("""|'''|"|')([\s\S]*)\2$/, "$3");
    const summary = bodyText.split(/\n/).map(part => part.trim()).find(Boolean) || undefined;
    return { kind: "python-docstring", raw, ...(summary ? { summary } : {}) };
  }
  function headerNode(node, language, declared) {
    const fn = functionNode(node, language);
    if (language === "julia") return first(node, ["signature"]) || declared.header || node;
    if (["c", "cpp"].includes(language)) return node;
    return fn;
  }
  function signaturePiece(file, text, node, language, declared) {
    const S = root.SkylenseSourceContracts;
    const header = headerNode(node, language, declared);
    // Kotlin's grammar gives the body no field name; its `function_body` child is
    // still the body, and a signature that ran into it would carry the code.
    const body = declared.body || first(header || node, ["function_body"]);
    let end = header?.endIndex ?? node.endIndex;
    if (body && body.startIndex >= (header?.startIndex ?? node.startIndex) && body.startIndex < end) end = body.startIndex;
    const start = header?.startIndex ?? node.startIndex;
    if (end <= start) return S.pieceFromNode(file, text, header || node);
    const lineStart = (header || node).startPosition.row + 1;
    let lineEnd = lineStart;
    for (let i = start; i < end; i++) if (text[i] === "\n") lineEnd++;
    return S.piece(file, text, start, end, lineStart, Math.max(lineEnd, lineStart));
  }
  function itemsFromList(file, text, list, extra = {}) {
    const S = root.SkylenseSourceContracts;
    return skipTrivia(children(list)).map((item, index) => S.itemFromNode(file, text, item, { groupIndex: extra.groupIndex ?? 0, index }));
  }
  function pythonParameters(file, text, node) {
    const S = root.SkylenseSourceContracts;
    const list = field(node, "parameters");
    if (!list) return S.statusBlock("unsupported", [], "Python parameter list was not present on this declaration.");
    const items = [];
    for (const item of skipTrivia(children(list))) {
      if (["positional_separator", "keyword_separator"].includes(item.type) || item.type === "identifier" && (sourceText(item, text) === "/" || sourceText(item, text) === "*") && item.parent === list)
        continue;
      if (item.type === "list_splat" && sourceText(item, text) === "*") continue;
      items.push(S.itemFromNode(file, text, item));
    }
    return S.statusBlock(list.hasError ? "partial" : "complete", items, list.hasError ? "Parameter list contains syntax recovery nodes." : undefined);
  }
  function jsParameters(file, text, node, language) {
    const S = root.SkylenseSourceContracts;
    const fn = functionNode(node, language);
    const params = field(fn, "parameters") || field(fn, "parameter");
    if (params?.type === "identifier" || params?.type === "required_parameter")
      return S.statusBlock("complete", [S.itemFromNode(file, text, params)]);
    if (params) return S.statusBlock("complete", itemsFromList(file, text, params));
    if (fn.type === "arrow_function") {
      const ident = children(fn).find(item => item.type === "identifier" && item.endIndex <= (field(fn, "body")?.startIndex ?? fn.endIndex));
      if (ident) return S.statusBlock("complete", [S.itemFromNode(file, text, ident)]);
    }
    return S.statusBlock("unsupported", [], "JavaScript/TypeScript parameter list was not located.");
  }
  function juliaParameters(file, text, node, declared) {
    const S = root.SkylenseSourceContracts;
    const head = juliaHead(node);
    const args = head?.type === "call_expression" ? first(head, ["argument_list"]) : first(declared.header, ["argument_list"]);
    if (!args) return S.statusBlock("unsupported", [], "Julia argument list was not located.");
    return S.statusBlock("complete", itemsFromList(file, text, args));
  }
  function juliaReturns(file, text, node, declared) {
    const S = root.SkylenseSourceContracts;
    let item = first(node, ["signature"]) || declared.header;
    while (item && ["signature", "where_expression"].includes(item.type)) item = children(item)[0];
    if (item?.type === "typed_expression") {
      const parts = children(item);
      if (parts.length >= 2 && parts[0].type === "call_expression") return S.statusBlock("explicit", [S.itemFromNode(file, text, parts.at(-1))]);
    }
    return S.statusBlock("unannotated", []);
  }
  function goParts(node) {
    const lists = children(node).filter(item => item.type === "parameter_list");
    if (node.type === "method_declaration") return { receiver: lists[0] || null, params: lists[1] || null, results: lists[2] || null };
    return { receiver: null, params: lists[0] || null, results: lists[1] || field(node, "result") };
  }
  function walkDeclarator(node, visit) {
    if (!node) return;
    visit(node);
    const inner = field(node, "declarator");
    if (inner) walkDeclarator(inner, visit);
    for (const child of children(node)) {
      if (child !== inner && ["pointer_declarator", "parenthesized_declarator", "function_declarator", "reference_declarator"].includes(child.type))
        walkDeclarator(child, visit);
    }
  }
  function cFunctionDeclarator(node) {
    let named = null, firstFn = null;
    walkDeclarator(field(node, "declarator") || node, item => {
      if (item.type !== "function_declarator") return;
      if (!firstFn) firstFn = item;
      let current = field(item, "declarator");
      for (let n = 0; current && n < 16; n++) {
        if (current.type === "identifier" || current.type === "field_identifier") { named = item; return; }
        if (current.type === "function_declarator") return;
        current = field(current, "declarator");
      }
    });
    return named || firstFn;
  }
  function cParameters(file, text, node) {
    const S = root.SkylenseSourceContracts;
    const declarator = cFunctionDeclarator(node);
    const list = field(declarator, "parameters") || first(declarator, ["parameter_list"]);
    if (!list) return S.statusBlock("unsupported", [], "C/C++ parameter list was not located.");
    const items = [];
    for (const item of skipTrivia(children(list))) {
      if (item.type === "comment") continue;
      const raw = sourceText(item, text);
      if (raw === "void") continue;
      items.push(S.itemFromNode(file, text, item));
    }
    return S.statusBlock(list.hasError ? "partial" : "complete", items, list.hasError ? "Parameter list contains syntax recovery nodes." : undefined);
  }
  function cReturns(file, text, node, declared) {
    const S = root.SkylenseSourceContracts;
    const declarator = cFunctionDeclarator(node);
    const trailing = field(declarator, "trailing_return_type") || first(declarator, ["trailing_return_type"]);
    if (trailing) {
      const type = first(trailing, ["type_descriptor"]) || children(trailing).find(item => item.type !== "auto") || trailing;
      return S.statusBlock("explicit", [S.itemFromNode(file, text, type)]);
    }
    const name = declared.nameNode;
    const type = field(node, "type") || children(node).find(item => /type|specifier|struct|class/.test(item.type) && !/storage/.test(item.type));
    if (!name || !type) return S.statusBlock("unsupported", [], "C/C++ return declarationer was not located.");
    let top = field(node, "declarator");
    while (top && ["pointer_declarator", "reference_declarator", "parenthesized_declarator"].includes(top.type)) top = field(top, "declarator");
    if (top && declarator && (top.startIndex !== declarator.startIndex || top.endIndex !== declarator.endIndex))
      return S.statusBlock("unsupported", [], "Complex C/C++ declarator return types are not assembled into a single type yet.");
    const droppedSpecifier = item => {
      if (!item) return true;
      if (["storage_class_specifier", "comment", "compound_statement", "attribute_declaration", "attribute_specifier"].includes(item.type)) return true;
      if (item.type === "type_qualifier" && /^(?:constexpr|consteval|constinit|explicit|virtual|friend)$/.test(sourceText(item, text))) return true;
      return false;
    };
    const typeish = item => {
      if (!item || droppedSpecifier(item)) return false;
      if (["function_declarator", "pointer_declarator", "parenthesized_declarator", "reference_declarator"].includes(item.type)) return false;
      return item.type === "type_qualifier" || /type|specifier|struct|class|union|enum|decltype|auto/.test(item.type);
    };
    const pieces = [];
    const pushRange = (start, end, keepSpace = false) => {
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return;
      const [from, to] = keepSpace ? [start, end] : S.trimRange(text, start, end);
      if (to <= from) return;
      pieces.push(S.piece(file, text, from, to, S.lineAt(text, from), S.lineAt(text, to - 1)));
    };
    const spaceBetween = (from, to) => {
      for (let i = from; i < to; i++) {
        if (text[i] === " " || text[i] === "\t") { pushRange(i, i + 1, true); return; }
        if (text[i] === "\r" || text[i] === "\n") {
          pushRange(i, text[i] === "\r" && text[i + 1] === "\n" ? i + 2 : i + 1, true);
          return;
        }
      }
    };
    for (const item of children(node)) {
      if (item.startIndex >= name.startIndex) break;
      if (droppedSpecifier(item)) continue;
      if (["pointer_declarator", "reference_declarator", "parenthesized_declarator", "function_declarator"].includes(item.type)) {
        if (item.startIndex < name.startIndex) {
          if (pieces.length) spaceBetween(pieces.at(-1).span.endIndex, item.startIndex);
          pushRange(item.startIndex, name.startIndex);
        }
        break;
      }
      if (typeish(item)) {
        if (pieces.length) spaceBetween(pieces.at(-1).span.endIndex, item.startIndex);
        pushRange(item.startIndex, item.endIndex);
      }
    }
    if (!pieces.length) return S.statusBlock("unsupported", [], "C/C++ return type range was empty.");
    const assembled = S.item(pieces);
    if (/\(/.test(assembled.text)) return S.statusBlock("unsupported", [], "Complex C/C++ declarator return types are not assembled into a single type yet.");
    return S.statusBlock("explicit", [assembled]);
  }
  function swiftParameters(file, text, node) {
    const S = root.SkylenseSourceContracts;
    const items = [];
    const kids = childFields(node);
    const nextSignificant = index => {
      for (let j = index + 1; j < kids.length; j++) {
        if (/comment/.test(kids[j].child.type)) continue;
        return kids[j];
      }
      return null;
    };
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].child.type !== "parameter") continue;
      const param = kids[i].child;
      let end = param.endIndex, lineEnd = lastLine(param);
      const next = nextSignificant(i);
      if (next?.field === "default_value") {
        end = next.child.endIndex;
        lineEnd = lastLine(next.child);
      }
      items.push(S.itemFromRange(file, text, param.startIndex, end, param.startPosition.row + 1, lineEnd));
    }
    return S.statusBlock("complete", items);
  }
  function scalaParameters(file, text, node) {
    const S = root.SkylenseSourceContracts;
    const groups = children(node).filter(item => item.type === "parameters");
    if (!groups.length) return S.statusBlock("unsupported", [], "Scala parameter clauses were not located.");
    const items = [];
    groups.forEach((group, groupIndex) => items.push(...itemsFromList(file, text, group, { groupIndex }).map((entry, index) => Object.freeze({ ...entry, groupIndex, index }))));
    return S.statusBlock("complete", items);
  }
  function genericParameters(file, text, node, language, declared) {
    const S = root.SkylenseSourceContracts;
    const fn = functionNode(node, language);
    // A Kotlin parameter list also holds each parameter's modifiers and default value as
    // siblings (`vararg`, `= null`); only the `parameter` nodes are the inputs.
    if (language === "kotlin") {
      const params = first(fn, ["function_value_parameters"]);
      if (params) return S.statusBlock("complete", skipTrivia(children(params)).filter(item => item.type === "parameter").map((item, index) => S.itemFromNode(file, text, item, { groupIndex: 0, index })));
    }
    const list = field(fn, "parameters") || field(fn, "parameter") || field(node, "parameters")
      || first(fn, ["formal_parameters", "parameters", "parameter_list", "method_parameters", "lambda_parameters", "function_value_parameters"]);
    if (list) return S.statusBlock("complete", itemsFromList(file, text, list));
    if (["c", "cpp"].includes(language)) return cParameters(file, text, node);
    return S.statusBlock("unsupported", [], `No parameter adapter for ${language} ${node.type}.`);
  }
  function genericReturns(file, text, node, language, declared) {
    const S = root.SkylenseSourceContracts;
    const fn = functionNode(node, language);
    const typed = field(fn, "return_type") || field(node, "return_type") || field(fn, "result") || field(node, "result");
    if (typed) {
      let start = typed.startIndex, end = typed.endIndex;
      if (text[start] === ":") { start += 1; while (start < end && /[ \t]/.test(text[start])) start++; }
      return S.statusBlock("explicit", [S.itemFromRange(file, text, start, end, typed.startPosition.row + 1, lastLine(typed))]);
    }
    if (language === "python") {
      const list = field(node, "parameters");
      const type = field(node, "return_type") || field(node, "type");
      if (type && type !== list) return S.statusBlock("explicit", [S.itemFromNode(file, text, type)]);
      return S.statusBlock("unannotated", []);
    }
    if (["java", "c_sharp"].includes(language)) {
      if (node.type === "constructor_declaration") return S.statusBlock("not-applicable", [], "Constructors do not declare a return type.");
      const type = field(node, "type");
      return type ? S.statusBlock("explicit", [S.itemFromNode(file, text, type)]) : S.statusBlock("unannotated", []);
    }
    if (language === "kotlin") {
      const params = first(fn, ["function_value_parameters"]);
      const body = first(fn, ["function_body"]);
      const type = children(fn).find(item => {
        if (["type_constraints", "type_constraint", "type_parameters", "type_parameter"].includes(item.type)) return false;
        if (!/type/.test(item.type)) return false;
        if (!params || item.startIndex < params.endIndex) return false;
        if (body && item.startIndex >= body.startIndex) return false;
        return true;
      });
      return type ? S.statusBlock("explicit", [S.itemFromNode(file, text, type)]) : S.statusBlock("unannotated", []);
    }
    if (language === "go") {
      const { results } = goParts(node);
      if (!results) return S.statusBlock("unannotated", []);
      return S.statusBlock("explicit", [S.itemFromNode(file, text, results)]);
    }
    if (language === "swift") {
      const kids = childFields(fn);
      let seenIdent = false;
      for (const { child, field } of kids) {
        if (!seenIdent && child.type === "simple_identifier") { seenIdent = true; continue; }
        if (child.type === "parameter" || field === "default_value" || child.type === "type_parameters" || child.type === "type_parameter") continue;
        if (["type_constraints", "type_constraint", "function_body", "where_keyword"].includes(child.type) || field === "body") continue;
        if (/type/.test(child.type)) return S.statusBlock("explicit", [S.itemFromNode(file, text, child)]);
      }
      return S.statusBlock("unannotated", []);
    }
    if (language === "scala") {
      const type = field(fn, "return_type") || children(fn).find(item => item.type === "type_identifier" || item.type === "generic_type" || item.type === "type");
      return type ? S.statusBlock("explicit", [S.itemFromNode(file, text, type)]) : S.statusBlock("unannotated", []);
    }
    if (["c", "cpp"].includes(language)) return cReturns(file, text, node, declared);
    if (language === "bash") return S.statusBlock("not-applicable", [], "Shell functions do not declare typed parameters or returns.");
    return S.statusBlock("unannotated", []);
  }
  function signatureContract(node, text, language, declared, path) {
    const S = root.SkylenseSourceContracts;
    const file = path || "";
    const engine = "tree-sitter";
    if (declared.kind !== "function") return S.notApplicable(language, engine, "Not a function declaration.");
    let parameters, returns, receiver;
    if (language === "python") { parameters = pythonParameters(file, text, node); returns = genericReturns(file, text, node, language, declared); }
    else if (JS.has(language)) { parameters = jsParameters(file, text, node, language); returns = genericReturns(file, text, node, language, declared); }
    else if (language === "julia") { parameters = juliaParameters(file, text, node, declared); returns = juliaReturns(file, text, node, declared); }
    else if (language === "go") {
      const parts = goParts(node);
      parameters = parts.params ? S.statusBlock("complete", itemsFromList(file, text, parts.params)) : S.statusBlock("unsupported", [], "Go parameter list was not located.");
      returns = genericReturns(file, text, node, language, declared);
      if (parts.receiver) receiver = S.itemFromNode(file, text, parts.receiver);
    }
    else if (language === "swift") { parameters = swiftParameters(file, text, node); returns = genericReturns(file, text, node, language, declared); }
    else if (language === "scala") { parameters = scalaParameters(file, text, node); returns = genericReturns(file, text, node, language, declared); }
    else if (["c", "cpp"].includes(language)) { parameters = cParameters(file, text, node); returns = cReturns(file, text, node, declared); }
    else if (language === "bash") {
      parameters = S.statusBlock("not-applicable", [], "Shell functions do not declare this kind of formal parameter list.");
      returns = S.statusBlock("not-applicable", [], "Shell functions do not declare a return type.");
    }
    else { parameters = genericParameters(file, text, node, language, declared); returns = genericReturns(file, text, node, language, declared); }
    if (parameters.items?.length > 2000) throw new Error(`Function ${declared.name} has more than 2000 parameters; complete indexing stopped.`);
    const documentation = language === "python" ? pythonDocstring(file, text, declared.body) : null;
    const sourceContract = S.contract({
      language, engine, signature: signaturePiece(file, text, node, language, declared),
      parameters, returns, receiver, documentation,
    });
    const compat = S.compatible(sourceContract);
    return { inputs: compat.inputs, outputs: compat.outputs, summary: documentation?.summary || "", sourceContract };
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
  /* PHP and shell references whose path is anchored to the declaring file rather
     than to the working directory. Only the documented idioms below qualify; any
     other computed path still produces no reference.
     PHP: __DIR__ is the directory of the file, dirname(__FILE__) equals it, and
       dirname($path, $levels) climbs $levels parents.
       https://www.php.net/manual/en/language.constants.magic.php
       https://www.php.net/manual/en/function.dirname.php
    Bash: ${BASH_SOURCE[0]} is the path the current file was read from, so its
      directory is this file's directory unless that path is a symlink; only the
      readlink -f/realpath forms name the real file's directory. $0 is the invoked
      script, which is this file only when it was executed rather than sourced.
      https://www.gnu.org/software/bash/manual/bash.html#index-BASH_005fSOURCE */
  function phpAnchoredInclude(node, text, namespace) {
    while (node && node.type === "parenthesized_expression") node = children(node).find(child => child.type !== "(" && child.type !== ")" && !/comment/.test(child.type));
    if (!node || node.type !== "binary_expression") return null;
    const left = field(node, "left"), right = field(node, "right");
    if (!left || !right || !/^\s*\.\s*$/.test(text.slice(left.endIndex, right.startIndex))) return null;
    const rest = literal(right, text, "php");
    if (!rest || !rest.startsWith("/")) return null;
    const anchor = sourceText(left, text).replace(/\s+/g, "");
    let up = null, caveat = null;
    if (/^__DIR__$/i.test(anchor)) up = 0;
    else {
      // An unqualified dirname() inside a namespace resolves to <namespace>\dirname
      // first, and `use function X\dirname` rebinds it anywhere; only the written
      // \dirname, or dirname in a global-namespace file importing no dirname, is
      // PHP's builtin. Otherwise the anchor is kept with a caveat (a candidate).
      const match = /^(\\?)dirname\((__DIR__|__FILE__)(?:,([1-9]))?\)$/i.exec(anchor);
      if (match) {
        up = (match[3] ? Number(match[3]) : 1) - (match[2].toUpperCase() === "__FILE__" ? 1 : 0);
        if (!match[1]) caveat = /\buse\s+function\b[^;]*\bdirname\b/i.test(text)
          ? "a `use function` clause in this file imports a dirname function, so dirname() may not be PHP's builtin"
          : namespace ? `dirname() in namespace ${namespace} resolves to ${namespace}\\dirname first when such a function is defined, so it may not be PHP's builtin` : null;
      }
    }
    if (up === null) return null;
    return { path: "../".repeat(up) + rest.slice(1), via: anchor, ...(caveat ? { caveat } : {}) };
  }
  /** A qualified name in a position where PHP can only mean a class name. */
  function phpClassPosition(node, text) {
    const parent = node.parent;
    if (!parent) return false;
    if (["object_creation_expression", "base_clause", "class_interface_clause"].includes(parent.type)) return true;
    if (["scoped_call_expression", "scoped_property_access_expression"].includes(parent.type)) return field(parent, "scope")?.id === node.id;
    if (parent.type === "class_constant_access_expression") return children(parent)[0]?.id === node.id;
    if (parent.type === "binary_expression" && field(parent, "right")?.id === node.id) {
      const left = field(parent, "left");
      return Boolean(left) && /^\s*instanceof\s*$/i.test(text.slice(left.endIndex, node.startIndex));
    }
    return false;
  }
  function shellDirPattern(subject, strip) {
    const target = String.raw`(?:${subject}|\$\((?:readlink -f|realpath) (?:-- )?${subject}\))`;
    const dirname = String.raw`(?:\$\(dirname (?:-- )?${target}\)|\x60dirname (?:-- )?${target}\x60)`;
    const cd = String.raw`\$\(cd (?:-P )?(?:-- )?${dirname}(?: ?(?:>|&>) ?/dev/null(?: 2>&1)?)? && pwd(?: -P)?\)`;
    return new RegExp(String.raw`^(?:${cd}|${dirname}|${strip})`);
  }
  const SHELL_DIRS = [
    { via: "BASH_SOURCE", pattern: shellDirPattern(String.raw`(?:\$\{BASH_SOURCE(?:\[0\])?\}|\$BASH_SOURCE)`, String.raw`\$\{BASH_SOURCE(?:\[0\])?%/\*\}`) },
    { via: "$0", pattern: shellDirPattern(String.raw`(?:\$\{0\}|\$0)`, String.raw`\$\{0%/\*\}`) },
  ];
  const SHELL_REST = /^\/[A-Za-z0-9._+@,=:/-]+$/;
  /** `"$(dirname "${BASH_SOURCE[0]}")/lib.sh"` → { via, absolute, rest }. Double
   *  quotes only group words here, so they are removed before matching. */
  function shellScriptDir(raw) {
    const flat = String(raw || "").replace(/"/g, "").replace(/\s+/g, " ").trim();
    for (const { via, pattern } of SHELL_DIRS) {
      const match = pattern.exec(flat);
      if (match) return { via, absolute: /^\$\(cd |readlink -f|realpath/.test(match[0]), real: /readlink -f|realpath/.test(match[0]), rest: flat.slice(match[0].length) };
    }
    return null;
  }
  // Commands whose redefinition (function, alias, `enable -n`) changes what a
  // script-directory idiom evaluates to or whether `source` loads a file.
  const SHELL_REDEFINABLE = ["source", ".", "cd", "pushd", "popd", "builtin", "command", "eval", "enable", "dirname", "readlink", "realpath", "pwd"];
  /** One pass over a bash file: assignments, the commands that can change the
   *  working directory or run computed code (cd/pushd/popd, through builtin or
   *  command, eval, trap), `source`/`.` commands, and the first redefinition of a
   *  command in SHELL_REDEFINABLE. Commands inside a subshell or substitution do
   *  not touch this shell's state and are left out. */
  function shellScan(tree, text) {
    const assignments = new Map(), moves = [], sources = [];
    let redefined = null;
    const insideAny = (node, types) => { for (let item = node.parent; item; item = item.parent) if (types.includes(item.type)) return true; return false; };
    const words = node => children(node).filter(child => child.type !== "command_name" && !/^(?:file_redirect|herestring_redirect|variable_assignment)$/.test(child.type)).map(child => sourceText(child, text).replace(/^["']|["']$/g, ""));
    const MOVES = ["cd", "pushd", "popd"];
    const queue = [tree.rootNode];
    while (queue.length) {
      const node = queue.pop();
      if (node.type === "variable_assignment") {
        const name = sourceText(field(node, "name"), text), list = assignments.get(name) || [];
        list.push(node); assignments.set(name, list);
      }
      if (node.type === "function_definition" && !redefined) {
        const name = sourceText(field(node, "name"), text);
        if (SHELL_REDEFINABLE.includes(name)) redefined = { node, name };
      }
      if (node.type === "command") {
        const name = sourceText(field(node, "name"), text), args = words(node);
        if (!redefined && name === "alias") { const hit = args.map(arg => /^([^=]+)=/.exec(arg)?.[1]).find(item => SHELL_REDEFINABLE.includes(item)); if (hit) redefined = { node, name: hit }; }
        if (!redefined && name === "enable") { const hit = args.find(arg => SHELL_REDEFINABLE.includes(arg)); if (hit) redefined = { node, name: hit }; }
        const isolated = insideAny(node, ["command_substitution", "subshell", "process_substitution"]);
        // `builtin cd`/`command cd`, eval and trap strings can move the directory; a
        // sourced file runs in this shell and can both cd and reassign variables.
        if (!isolated && (MOVES.includes(name) || (["builtin", "command"].includes(name) && MOVES.includes(args[0])) || name === "eval" || name === "trap")) moves.push(node);
        if (!isolated && ["source", "."].includes(name)) sources.push(node);
      }
      queue.push(...children(node));
    }
    return { assignments, moves, sources, redefined, insideAny };
  }
  /** Resolve `source`/`.` arguments built from a script-directory idiom, directly or
   *  through one top-level variable assigned exactly once from such an idiom. The
   *  idiom is relative to the working directory at the moment it is evaluated, so a
   *  cd/pushd/popd, eval or earlier `source` that can run first, a non-bash dialect, or a
   *  redefined command is recorded as a caveat on the fact. When the only reasons
   *  are earlier `source` commands, their start offsets are recorded as `after`, so
   *  the project resolver can drop the caveat once it shows each sourced file is inert. */
  function shellAnchoredSources(scan, text, pending, reference, path = "") {
    const { assignments, moves, sources, redefined, insideAny } = scan;
    const topLevel = node => { for (let item = node.parent; item; item = item.parent) { if (item.type === "program") return true; if (item.type !== "declaration_command") return false; } return false; };
    // A command can run before `node` when it starts earlier, when `node` sits in a
    // function (called later), or when both share a loop body (the next iteration).
    const loops = node => { const found = []; for (let item = node.parent; item; item = item.parent) if (["for_statement", "c_style_for_statement", "while_statement"].includes(item.type)) found.push(item); return found; };
    const runsBefore = (other, node, inFunction) => other !== node && (inFunction || other.startIndex < node.startIndex || loops(node).some(loop => other.startIndex >= loop.startIndex && other.endIndex <= loop.endIndex));
    const describe = move => `${sourceText(field(move, "name"), text)} on line ${move.startPosition.row + 1}`;
    // BASH_SOURCE is bash-only: empty in zsh, dash and sh.
    const shebang = /^#!([^\n]*)/.exec(text)?.[1] || "";
    const bash = shebang ? /\bbash\b/.test(shebang) : /\.(?:sh|bash)$/i.test(String(path || ""));
    for (const { node, raw } of pending) {
      const label = raw.replace(/\s+/g, " ").trim().slice(0, 240), flat = raw.replace(/"/g, "").replace(/\s+/g, " ").trim();
      const inFunction = insideAny(node, ["function_definition"]);
      let found = shellScriptDir(raw), move = null, sourceMove = null, variable = null, reassigned = null;
      const blockers = new Set();
      const before = (anchor, fn) => { const hits = sources.filter(item => item !== node && runsBefore(item, anchor, fn)); hits.forEach(item => blockers.add(item)); return hits[0] || null; };
      if (found) { move = moves.find(item => runsBefore(item, node, inFunction)) || null; sourceMove = before(node, inFunction); }
      else {
        const use = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))(\/.*)$/.exec(flat);
        if (!use) continue;
        variable = use[1] || use[2];
        const list = assignments.get(variable) || [];
        if (list.length !== 1 || !topLevel(list[0]) || list[0].endIndex > node.startIndex) continue;
        if (new RegExp(String.raw`\b(?:read|unset|local|declare|typeset|for|select|mapfile|readarray|getopts|printf\s+-v|eval|export\s+-n)\b[^\n;]*\b${variable}\b`).test(text)) continue;
        const value = shellScriptDir(sourceText(field(list[0], "value"), text));
        if (!value || value.rest) continue;
        found = { ...value, rest: use[3] };
        // A sourced file shares this shell's variables, so one run between the
        // assignment and the use (or at any time for a use in a function or loop) can reassign it.
        const assigned = list[0];
        const reassigning = sources.filter(item => item !== node && item.startIndex > assigned.endIndex && (inFunction || runsBefore(item, node, inFunction)));
        reassigning.forEach(item => blockers.add(item));
        reassigned = reassigning[0] || null;
        // An absolute value is fixed once assigned; a relative one is re-read
        // against whatever the working directory is when the file is sourced.
        move = moves.find(item => runsBefore(item, assigned, false)) || (!value.absolute && moves.find(item => runsBefore(item, node, inFunction))) || null;
        const early = before(assigned, false), late = value.absolute ? null : before(node, inFunction);
        sourceMove = early || late;
      }
      if (!found || !SHELL_REST.test(found.rest)) continue;
      // Ordered reasons; the first is reported. Only `source`-based ones can be lifted.
      const reasons = [
        found.via === "$0" && { text: "$0 names the script that was invoked, which is this file only when it is executed rather than sourced" },
        !bash && { text: `${path || "this file"} is not declared as a bash script, and BASH_SOURCE is empty in zsh, dash and sh` },
        redefined && { text: `${redefined.name} is redefined on line ${redefined.node.startPosition.row + 1}, so the path or the load may not be what bash's own command gives` },
        reassigned && { text: `the file sourced on line ${reassigned.startPosition.row + 1} runs in the same shell and can reassign ${variable}`, liftable: true },
        (move || sourceMove) && { text: `the working directory can change (${describe(move || sourceMove)}) before the path is evaluated, so the relative BASH_SOURCE path may no longer name this file's directory`, liftable: !move },
        !found.real && { text: `BASH_SOURCE names the path the file was read from, which is a symlink's directory when ${path || "this file"} is invoked through a symlink; only readlink -f or realpath names the real file's directory` },
      ].filter(Boolean);
      const caveat = reasons[0]?.text || null;
      const after = reasons.length && reasons.every(reason => reason.liftable) ? [...blockers].map(item => item.startIndex).sort((a, b) => a - b) : null;
      reference(node, label, "shell-source", { static: true, anchor: "script-dir", via: found.via, path: found.rest.slice(1), ...(variable ? { variable } : {}), ...(caveat ? { caveat } : {}), ...(after ? { after } : {}) });
    }
  }
  /* ---- Call-binding facts for Go and Rust ----------------------------------
     Syntax only. Each call records the shape of its callee and the local
     bindings that could shadow or type it; src/semantic-calls.js decides with
     the whole snapshot. A form this reader does not model is recorded as null,
     which the resolver reads as "abstain", never as "no binding". */
  const CALLEE_DEPTH = 6;
  function namedFields(node, name) {
    const list = [];
    for (const { child, field: label } of childFields(node)) if (label === name) list.push(child);
    return list;
  }
  /** Preorder walk; `visit` returning false skips the subtree. False when the ceiling was hit. */
  function walk(node, visit, max = 400000) {
    const stack = [node]; let seen = 0;
    while (stack.length) {
      const item = stack.pop(); if (!item) continue;
      if (++seen > max) return false;
      if (visit(item) === false) continue;
      const list = children(item); for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
    return true;
  }
  function callNodes(top) {
    const found = [];
    const complete = walk(top, node => { if (node.type === "call_expression") found.push(node); });
    return complete ? found : null;
  }
  const callKey = node => node.startIndex + ":" + node.endIndex;
  // Go: https://go.dev/ref/spec#Declarations_and_scope — every form that declares a
  // name inside a function body is listed in goLocals below.
  const GO_SCOPE = new Set(["block", "if_statement", "for_statement", "expression_switch_statement", "type_switch_statement", "select_statement", "expression_case", "type_case", "default_case", "communication_case", "func_literal", "function_declaration", "method_declaration"]);
  const GO_FUNCTION = new Set(["func_literal", "function_declaration", "method_declaration"]);
  function goTypeRef(node, text) {
    let pointer = false;
    for (let n = 0; node && n < 8 && ["pointer_type", "parenthesized_type"].includes(node.type); n++) { pointer ||= node.type === "pointer_type"; node = children(node)[0]; }
    if (node?.type === "type_identifier") return { name: sourceText(node, text), pointer };
    if (node?.type === "qualified_type") {
      const pkg = field(node, "package"), name = field(node, "name");
      if (pkg && name?.type === "type_identifier") return { pkg: sourceText(pkg, text), name: sourceText(name, text), pointer };
    }
    return null;
  }
  /** Declared result types, one per result value; null when the list is not modelled. */
  function goResults(node, text) {
    const result = field(node, "result");
    if (!result) return [];
    if (result.type !== "parameter_list") return [goTypeRef(result, text)];
    const list = [];
    for (const item of children(result)) {
      if (/comment/.test(item.type)) continue;
      if (item.type !== "parameter_declaration") return null;
      const ref = goTypeRef(field(item, "type"), text), count = namedFields(item, "name").length || 1;
      for (let i = 0; i < count; i++) list.push(ref);
    }
    return list;
  }
  function goCallFacts(rootNode, text, calls) {
    const out = { language: "go", package: null, imports: [], functions: [], methods: [], types: [], names: [], truncated: false };
    const line = node => node.startPosition.row + 1;
    const declare = name => { if (name && name !== "_") out.names.push(name); };
    const byKey = new Map(calls.map(call => [call.startIndex + ":" + call.endIndex, call]));
    for (const top of children(rootNode)) {
      const type = top.type;
      if (type === "package_clause") {
        out.package = sourceText(children(top)[0], text) || null;
        // A build constraint before the package clause decides whether the file is
        // compiled at all (https://pkg.go.dev/cmd/go#hdr-Build_constraints).
        const header = text.slice(0, top.startIndex).match(/^\s*\/\/(?:go:build\s.*|\s*\+build\s.*)$/m);
        if (header) out.constraint = header[0].trim();
      }
      else if (type === "import_declaration") for (const spec of descendants(top, node => node.type === "import_spec")) {
        const value = literal(field(spec, "path"), text, "go"), name = field(spec, "name");
        if (value) out.imports.push({ path: value, name: name ? sourceText(name, text) : null, line: line(spec) });
      }
      else if (type === "function_declaration") {
        const name = identifier(field(top, "name"), text);
        if (name) { declare(name); out.functions.push({ name, startIndex: top.startIndex, line: line(top), generic: Boolean(field(top, "type_parameters")), results: goResults(top, text) }); }
      }
      else if (type === "method_declaration") {
        const receivers = children(field(top, "receiver")).filter(item => item.type === "parameter_declaration");
        let base = receivers.length === 1 ? field(receivers[0], "type") : null, generic = false;
        for (let n = 0; base && n < 8 && ["pointer_type", "parenthesized_type"].includes(base.type); n++) base = children(base)[0];
        if (base?.type === "generic_type") { generic = true; base = field(base, "type"); }
        const name = identifier(field(top, "name"), text);
        if (name && base?.type === "type_identifier") out.methods.push({ receiver: sourceText(base, text), name, startIndex: top.startIndex, line: line(top), generic, results: goResults(top, text) });
      }
      else if (type === "type_declaration") for (const spec of children(top)) {
        const name = identifier(field(spec, "name"), text);
        if (!name || !["type_spec", "type_alias"].includes(spec.type)) continue;
        declare(name);
        if (spec.type === "type_alias") { out.types.push({ name, kind: "alias", startIndex: spec.startIndex, line: line(spec) }); continue; }
        const body = field(spec, "type"), kind = body?.type === "struct_type" ? "struct" : body?.type === "interface_type" ? "interface" : "defined";
        const fields = []; let embedded = false;
        if (kind === "struct") for (const decl of descendants(body, node => node.type === "field_declaration")) {
          const names = namedFields(decl, "name");
          if (!names.length) { embedded = true; continue; }
          const ref = goTypeRef(field(decl, "type"), text);
          for (const item of names) fields.push({ name: sourceText(item, text), type: ref });
        }
        out.types.push({ name, kind, generic: Boolean(field(spec, "type_parameters")), startIndex: spec.startIndex, line: line(spec), fields, embedded });
      }
      else if (type === "var_declaration" || type === "const_declaration") {
        for (const spec of descendants(top, node => node.type === "var_spec" || node.type === "const_spec")) for (const item of namedFields(spec, "name")) declare(sourceText(item, text));
      }
      const found = callNodes(top);
      if (!found) { out.truncated = true; continue; }
      if (!found.length) continue;
      const locals = goLocals(top, text);
      if (!locals) { out.truncated = true; continue; }
      for (const node of found) {
        const call = byKey.get(callKey(node));
        if (!call) continue;
        call.callee = goExpr(locals, field(node, "function"), text, 0);
      }
    }
    return out;
  }
  /** Every name a declaration inside `top` binds, with its scope and, where the
   *  source states it, its declared type or initializer. */
  function goLocals(top, text) {
    const map = new Map();
    const scopeOf = node => { for (let item = node.parent; item; item = item.parent) if (GO_SCOPE.has(item.type)) return item; return top; };
    const add = (nameNode, binding) => {
      const name = sourceText(nameNode, text);
      if (!name || name === "_") return;
      const list = map.get(name) || []; list.push({ line: nameNode.startPosition.row + 1, ...binding }); map.set(name, list);
    };
    const range = scope => ({ scopeStart: scope.startIndex, scopeEnd: scope.endIndex });
    const complete = walk(top, node => {
      const type = node.type;
      if (type === "parameter_declaration" || type === "variadic_parameter_declaration") {
        let fn = null; for (let item = node.parent; item; item = item.parent) if (GO_FUNCTION.has(item.type)) { fn = item; break; }
        const scope = fn || scopeOf(node), typeParameter = node.parent?.type === "type_parameter_list";
        const typed = typeParameter || type === "variadic_parameter_declaration" ? null : goTypeRef(field(node, "type"), text);
        for (const name of namedFields(node, "name")) add(name, { from: field(fn, "body")?.startIndex ?? node.endIndex, ...range(scope), type: typed });
      } else if (type === "var_spec") {
        const scope = scopeOf(node), names = namedFields(node, "name"), declared = field(node, "type"), values = children(field(node, "value"));
        names.forEach((name, index) => add(name, { from: node.endIndex, ...range(scope), type: declared ? goTypeRef(declared, text) : null, ...(!declared ? goInit(values, names.length, index) : {}) }));
      } else if (type === "short_var_declaration") {
        const scope = scopeOf(node), names = children(field(node, "left")), values = children(field(node, "right"));
        names.forEach((name, index) => { if (name.type === "identifier") add(name, { from: node.endIndex, ...range(scope), type: null, ...goInit(values, names.length, index) }); });
      } else if (type === "const_spec") {
        for (const name of namedFields(node, "name")) add(name, { from: node.endIndex, ...range(scopeOf(node)), type: null });
      } else if (type === "range_clause" || type === "receive_statement") {
        for (const name of children(field(node, "left"))) if (name.type === "identifier") add(name, { from: node.endIndex, ...range(scopeOf(node)), type: null });
      } else if (type === "type_switch_statement") {
        for (const name of children(field(node, "alias"))) if (name.type === "identifier") add(name, { from: node.startIndex, ...range(node), type: null });
      } else if ((type === "type_spec" || type === "type_alias") && node.parent?.id !== top.id) {
        const name = field(node, "name"); if (name) add(name, { from: node.startIndex, ...range(scopeOf(node)), type: null });
      } else if (type === "method_declaration") {
        // `func (l *List[T]) …` declares T for the method.
        for (const parameter of children(field(node, "receiver"))) for (const generic of descendants(parameter, item => item.type === "type_arguments")) for (const name of children(generic)) if (name.type === "type_identifier") add(name, { from: node.startIndex, ...range(node), type: null });
      }
    });
    return complete ? map : null;
  }
  function goInit(values, count, index) {
    if (values.length === count) return { init: values[index], index: 0, count: 1 };
    if (values.length === 1 && count > 1) return { init: values[0], index, count };
    return {};
  }
  /** The static shape of an expression, or null where this reader cannot state it. */
  function goExpr(locals, node, text, depth) {
    if (!node || depth > CALLEE_DEPTH) return null;
    const typeRef = ref => !ref || locals.has(ref.pkg || ref.name) ? null : ref;
    switch (node.type) {
      case "parenthesized_expression": return goExpr(locals, children(node)[0], text, depth + 1);
      case "identifier": {
        const name = sourceText(node, text), list = locals.get(name);
        if (!list) return { e: "name", name };
        if (list.length !== 1) return null;
        const local = list[0], at = node.startIndex;
        if (at < local.from || at < local.scopeStart || at >= local.scopeEnd) return null;
        if (local.type) { const type = typeRef(local.type); return type ? { e: "typed", name, type, line: local.line } : null; }
        if (local.init) { const value = goExpr(locals, local.init, text, depth + 1); return value ? { e: "init", name, value, index: local.index, count: local.count, line: local.line } : null; }
        return null;
      }
      case "composite_literal": { const type = typeRef(goTypeRef(field(node, "type"), text)); return type ? { e: "value", type } : null; }
      case "unary_expression": {
        const operand = field(node, "operand");
        return /^\s*&/.test(sourceText(node, text)) && operand?.type === "composite_literal" ? goExpr(locals, operand, text, depth + 1) : null;
      }
      case "call_expression": {
        if (field(node, "type_arguments")) return null;
        const fn = goExpr(locals, field(node, "function"), text, depth + 1);
        return fn ? { e: "call", fn } : null;
      }
      case "selector_expression": {
        const operand = goExpr(locals, field(node, "operand"), text, depth + 1), name = identifier(field(node, "field"), text);
        return operand && name ? { e: "select", operand, field: name } : null;
      }
    }
    return null;
  }
  // Rust: https://doc.rust-lang.org/reference/names/name-resolution.html and
  // https://doc.rust-lang.org/reference/paths.html — locals and block items shadow
  // module items; `crate`, `self` and `super` walk the module tree.
  const RUST_KEYWORDS = new Set(["crate", "self", "super"]);
  /** Names of the outer attributes written immediately before `node`. */
  function rustAttributes(node, text) {
    const names = [];
    for (let item = node.previousNamedSibling; item && (item.type === "attribute_item" || /comment/.test(item.type)); item = item.previousNamedSibling) {
      if (item.type !== "attribute_item") continue;
      const attribute = children(item)[0];
      names.push(sourceText(children(attribute)[0] || attribute, text));
    }
    return names;
  }
  function rustPath(node, text) {
    if (!node) return null;
    if (["identifier", "crate", "self", "super"].includes(node.type)) return [sourceText(node, text)];
    if (node.type !== "scoped_identifier") return null;
    const path = field(node, "path"), name = field(node, "name");
    if (!path || !name || name.type !== "identifier") return null;
    const head = rustPath(path, text);
    return head ? [...head, sourceText(name, text)] : null;
  }
  /** `meta` is { conditional, line, visibility } of the enclosing use declaration. */
  function rustUses(node, prefix, module, meta, text) {
    if (!node) return;
    const add = (name, segments) => module.uses.push({ name, segments, ...meta });
    if (["identifier", "crate", "self", "super", "scoped_identifier"].includes(node.type)) {
      const path = rustPath(node, text);
      const segments = path && prefix ? [...prefix, ...path] : null;
      const name = node.type === "scoped_identifier" ? sourceText(field(node, "name"), text) : sourceText(node, text);
      if (name === "self" && node.type === "self") add(prefix?.at(-1) || null, prefix);
      else add(name, segments);
    } else if (node.type === "use_as_clause") {
      const path = rustPath(field(node, "path"), text);
      add(sourceText(field(node, "alias"), text), path && prefix ? [...prefix, ...path] : null);
    } else if (node.type === "scoped_use_list") {
      const path = field(node, "path"), head = path ? rustPath(path, text) : null;
      const next = head && prefix ? [...prefix, ...head] : null;
      for (const item of children(field(node, "list"))) rustUses(item, next, module, meta, text);
    } else if (node.type === "use_list") {
      for (const item of children(node)) rustUses(item, prefix, module, meta, text);
    } else if (node.type === "use_wildcard") {
      const target = children(node)[0], path = target ? rustPath(target, text) : null;
      module.globs = true;
      (module.globPaths ||= []).push({ segments: path && prefix ? [...prefix, ...path] : null, ...meta });
    } else module.unmodelledUse = true;
  }
  const rustVisibility = (node, text) => { const modifier = children(node).find(item => item.type === "visibility_modifier"); return modifier ? sourceText(modifier, text).replace(/\s+/g, "") : null; };
  function rustCallFacts(rootNode, text, calls) {
    const out = { language: "rust", modules: [], truncated: false };
    const byKey = new Map(calls.map(call => [call.startIndex + ":" + call.endIndex, call]));
    const line = node => node.startPosition.row + 1;
    const nameOf = node => sourceText(field(node, "name"), text) || null;
    function moduleFacts(container, chain, conditional) {
      const module = { chain, conditional, functions: [], values: [], types: [], children: [], uses: [], globs: false, globPaths: [], unmodelledUse: false, macros: [] };
      out.modules.push(module);
      for (const item of children(container)) {
        const type = item.type;
        // The ERROR siblings of a misparsed multi-line first inner attribute (see
        // rustAttributeMisparse) carry no item.
        if (type === "ERROR" && container.type === "source_file" && rustAttributeMisparse(container, text)) continue;
        // A module-level macro invocation expands to items and imports this reader
        // never sees; they shadow glob imports, so the module records that it has one.
        const invoked = type === "macro_invocation" ? item : type === "expression_statement" && children(item)[0]?.type === "macro_invocation" ? children(item)[0] : null;
        if (invoked) module.macros.push(sourceText(field(invoked, "macro"), text) || "?");
        if (type === "inner_attribute_item" || type === "shebang" && /^#!\[/.test(sourceText(item, text))) {
          if (/^#!\[\s*cfg(?:_attr)?\b/.test(sourceText(item, text))) module.conditional = true;
          continue;
        }
        const attributes = rustAttributes(item, text), gated = attributes.some(name => name === "cfg" || name === "cfg_attr");
        const name = nameOf(item);
        if (type === "function_item" && name) module.functions.push({ name, startIndex: item.startIndex, line: line(item), attributes, visibility: rustVisibility(item, text) });
        else if ((type === "const_item" || type === "static_item") && name) module.values.push(name);
        else if (type === "struct_item" && name) { module.types.push(name); if (field(item, "body")?.type !== "field_declaration_list") module.values.push(name); }
        else if (["enum_item", "trait_item", "type_item", "union_item"].includes(type) && name) module.types.push(name);
        else if (type === "extern_crate_declaration") module.types.push(sourceText(field(item, "alias") || field(item, "name"), text));
        else if (type === "foreign_mod_item") for (const declared of descendants(item, node => ["function_signature_item", "static_item"].includes(node.type))) { const value = nameOf(declared); if (value) module.values.push(value); }
        else if (type === "mod_item" && name) {
          const body = field(item, "body");
          module.children.push({ name, startIndex: item.startIndex, line: line(item), inline: Boolean(body), conditional: gated });
          if (body) moduleFacts(body, [...chain, name], gated);
        } else if (type === "use_declaration") rustUses(field(item, "argument"), [], module, { conditional: gated, line: line(item), visibility: rustVisibility(item, text) }, text);
        if (type === "mod_item" || type === "use_declaration" || type === "macro_definition") continue;
        const found = callNodes(item);
        if (!found) { out.truncated = true; continue; }
        if (!found.length) continue;
        // Locals are scoped to the outermost function that holds the call, so a
        // parameter of one impl method never shadows a call in another. Only a method
        // of a module-level impl or trait narrows the scope: a method of an impl
        // declared inside a function body still sees that body's block items.
        const scopes = new Map();
        // Node wrappers are recreated on every `.parent` access, so identity is the id.
        const scopeFor = node => {
          let scope = item, blockModule = null;
          for (let current = node.parent; current && current.id !== item.id; current = current.parent) {
            if (current.type === "mod_item") blockModule = current;
            if (current.type === "function_item" && current.parent?.type === "declaration_list" && current.parent.parent?.id === item.id) scope = current;
          }
          return { scope, blockModule };
        };
        for (const node of found) {
          const call = byKey.get(callKey(node));
          if (!call) continue;
          const { scope, blockModule } = scopeFor(node);
          if (blockModule) { call.callee = { path: null, chain, reason: `The call sits inside the block-level module \`mod ${sourceText(field(blockModule, "name"), text)}\`, whose items this reader does not index` }; continue; }
          if (!scopes.has(scope.startIndex)) scopes.set(scope.startIndex, rustLocals(scope, text));
          const locals = scopes.get(scope.startIndex);
          if (!locals) { out.truncated = true; continue; }
          let callee = field(node, "function");
          const turbofish = callee?.type === "generic_function";
          if (turbofish) callee = field(callee, "function");
          const path = rustPath(callee, text), head = path?.[0];
          const shadowed = Boolean(path) && (locals.glob || (path.length === 1 ? locals.values.has(head) || locals.blockValues.has(head) : !RUST_KEYWORDS.has(head) && locals.blockTypes.has(head)));
          call.callee = { path, chain, shadowed, ...(locals.macros.length ? { macros: locals.macros } : {}), ...(turbofish ? { turbofish: true } : {}) };
        }
      }
    }
    moduleFacts(rootNode, [], false);
    // `macro_rules!` names defined anywhere in the file, and whether `#[macro_use]`
    // imports macros by name: either can redefine a standard macro such as println!.
    const macroRules = new Set();
    if (!walk(rootNode, node => { if (node.type === "macro_definition") { macroRules.add(sourceText(field(node, "name"), text)); return false; } })) out.truncated = true;
    out.macroRules = [...macroRules];
    out.macroUse = /#\s*!?\[\s*macro_use\b/.test(text);
    return out;
  }
  /** Value names a pattern, parameter or closure inside `top` binds, and items declared in its blocks. */
  function rustLocals(top, text) {
    const values = new Set(), blockValues = new Set(), blockTypes = new Set(), macros = new Set(); let glob = false;
    // A tuple-struct or struct pattern's path (`Some(x)`, `Point { x, .. }`) names
    // a constructor, not a binding; every other identifier in a pattern may bind.
    const constructor = item => ["tuple_struct_pattern", "struct_pattern"].includes(item.parent?.type) && field(item.parent, "type")?.startIndex === item.startIndex;
    const bindIdentifiers = node => walk(node, item => {
      if (item.type === "scoped_identifier" || item.type === "scoped_type_identifier") return false;
      if (item.type === "identifier" || item.type === "shorthand_field_identifier") { if (!constructor(item)) values.add(sourceText(item, text)); return false; }
    });
    const complete = walk(top, node => {
      for (const { child, field: label } of childFields(node)) if (label === "pattern") bindIdentifiers(child);
      if (node.type === "closure_parameters") bindIdentifiers(node);
      if (node.type === "const_parameter") { const name = field(node, "name"); if (name) values.add(sourceText(name, text)); }
      // A statement-position macro may expand to a block item (macro_rules items are
      // not hygienic) or to a `let` naming an identifier it was passed. rustc parses a
      // `()`/`[]` macro without `;` as an expression macro, which yields one expression
      // and adds neither, so only `m!(…);` and brace-delimited `m! { … }` count.
      const statementMacro = node.type === "macro_invocation" && (node.parent?.type === "expression_statement" && node.parent.parent?.type === "block"
        || node.parent?.type === "block" && /^\{/.test(sourceText(children(node).find(item => item.type === "token_tree"), text)));
      if (statementMacro) macros.add(sourceText(field(node, "macro"), text) || "?");
      if (node.parent?.type !== "block") return;
      const name = sourceText(field(node, "name"), text);
      if (["function_item", "const_item", "static_item"].includes(node.type) && name) blockValues.add(name);
      else if (["mod_item", "struct_item", "enum_item", "trait_item", "type_item", "union_item"].includes(node.type) && name) { blockTypes.add(name); if (node.type === "struct_item") blockValues.add(name); }
      else if (node.type === "use_declaration") {
        const module = { uses: [], globs: false, unmodelledUse: false };
        rustUses(field(node, "argument"), [], module, { conditional: false, line: 0, visibility: null }, text);
        glob ||= module.globs || module.unmodelledUse;
        for (const use of module.uses) if (use.name) { blockValues.add(use.name); blockTypes.add(use.name); }
      } else if (node.type === "extern_crate_declaration") blockTypes.add(sourceText(field(node, "alias") || field(node, "name"), text));
    });
    return complete ? { values, blockValues, blockTypes, glob, macros: [...macros] } : null;
  }
  // Java: https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.4 (shadowing
  // and obscuring), #jls-6.5.2 (a simple name is a variable before it is a type) and
  // jls-15.html#jls-15.12.1 (the class to search). Every class-like declaration is
  // recorded with the members it declares directly; src/semantic-calls.js walks
  // supertypes with the whole snapshot.
  const JAVA_KIND = { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record", annotation_type_declaration: "annotation" };
  const JAVA_BODY = new Set(["class_body", "interface_body", "enum_body", "annotation_type_body"]);
  const JAVA_REWRITERS = /^(?:lombok|manifold)(?:\.|$)/;
  function javaModifiers(node, text) {
    const keywords = [], annotations = [];
    const modifiers = children(node).find(item => item.type === "modifiers");
    for (let i = 0; modifiers && i < modifiers.childCount; i++) {
      const item = modifiers.child(i);
      if (/annotation/.test(item.type)) annotations.push(sourceText(field(item, "name"), text).replace(/\s+/g, ""));
      else if (!item.isNamed) keywords.push(item.type);
    }
    return { keywords, annotations };
  }
  /** A written type: `{ name }` for a plain or generic name, `{ qualified }` for a dotted one, null otherwise. */
  function javaTypeName(node, text) {
    if (node?.type === "generic_type") node = children(node)[0];
    if (node?.type === "type_identifier") return { name: sourceText(node, text) };
    if (node?.type === "scoped_type_identifier") return { qualified: sourceText(node, text).replace(/\s+/g, "") };
    return null;
  }
  function javaCallFacts(rootNode, text, calls) {
    // javac translates Unicode escapes before tokenizing (JLS 3.3) and ends a line at a
    // lone CR (JLS 3.4); tree-sitter does neither. Where an escape or a lone CR can end a
    // comment or literal, the two read different programs, so the file is not modelled.
    const lexical = /\r(?!\n)|\\u+(?:000[aAdD]|00(?:2[27aAfF]|5[cC]))/.test(text);
    const out = { language: "java", package: "", packageKnown: false, imports: [], types: [], values: [], typeParameters: [], rewriting: false, partial: Boolean(rootNode.hasError) || lexical, lexical, truncated: false };
    const byKey = new Map(calls.map(call => [callKey(call), call]));
    const bodies = new Map(), values = new Set(), typeParameters = new Set();
    const line = node => node.startPosition.row + 1;
    const value = node => { const name = identifier(node, text); if (name) values.add(name); };
    /** Index of the innermost class-like declaration whose body holds `node`. */
    const ownerOf = node => {
      for (let item = node.parent; item; item = item.parent) if (JAVA_BODY.has(item.type)) return bodies.has(callKey(item)) ? bodies.get(callKey(item)) : null;
      return null;
    };
    const isMember = node => Boolean(node.parent) && (JAVA_BODY.has(node.parent.type) || node.parent.type === "enum_body_declarations");
    const typeList = node => { const list = children(children(node).find(item => item.type === "type_list")).map(item => javaTypeName(item, text)); return list.includes(null) ? null : list; };
    function addType(node, kind, name, body, supers, explicitSuperclass) {
      const anonymous = kind === "anonymous", { keywords, annotations } = anonymous ? { keywords: [], annotations: [] } : javaModifiers(node, text);
      const parent = ownerOf(node), member = !anonymous && isMember(node);
      const type = { name, kind, parent, member, modifiers: keywords, annotations, supers, explicitSuperclass, methods: [], fields: [], memberTypes: [], components: [], constantBodies: false, startIndex: node.startIndex, line: line(node) };
      if (annotations.some(item => JAVA_REWRITERS.test(item))) out.rewriting = true;
      if (body) bodies.set(callKey(body), out.types.length);
      if (parent !== null && member && name) out.types[parent].memberTypes.push(name);
      out.types.push(type);
      return type;
    }
    const complete = walk(rootNode, node => {
      const type = node.type;
      if (type === "package_declaration") { out.package = sourceText(children(node).find(item => /identifier/.test(item.type)), text).replace(/\s+/g, ""); out.packageKnown = !node.hasError && !lexical && Boolean(out.package); }
      else if (type === "import_declaration") {
        const target = children(node).find(item => item.type === "scoped_identifier" || item.type === "identifier"), path = sourceText(target, text).replace(/\s+/g, "");
        let isStatic = false; for (let i = 0; i < node.childCount; i++) if (node.child(i).type === "static") isStatic = true;
        if (path) out.imports.push({ path, static: isStatic, onDemand: children(node).some(item => item.type === "asterisk"), line: line(node) });
        if (JAVA_REWRITERS.test(path)) out.rewriting = true;
        return false;
      } else if (JAVA_KIND[type]) {
        const kind = JAVA_KIND[type], name = identifier(field(node, "name"), text);
        const superclass = field(node, "superclass"), interfaces = field(node, "interfaces") || children(node).find(item => item.type === "extends_interfaces");
        let supers = [];
        if (superclass) supers.push(javaTypeName(children(superclass)[0], text));
        if (interfaces) { const list = typeList(interfaces); supers = list ? [...supers, ...list] : [null]; }
        const declared = addType(node, kind, name, field(node, "body"), supers.includes(null) ? null : supers, Boolean(superclass));
        if (kind === "record") for (const item of children(field(node, "parameters"))) {
          const component = item.type === "spread_parameter" ? field(children(item).find(child => child.type === "variable_declarator"), "name") : field(item, "name");
          const label = identifier(component, text); if (label) declared.components.push(label);
        }
      } else if (type === "object_creation_expression") {
        const body = children(node).find(item => item.type === "class_body");
        if (body) addType(node, "anonymous", null, body, [javaTypeName(field(node, "type"), text)].includes(null) ? null : [javaTypeName(field(node, "type"), text)], true);
      } else if (type === "enum_constant") {
        const owner = ownerOf(node), name = identifier(field(node, "name"), text);
        value(field(node, "name"));
        if (owner !== null && name) out.types[owner].fields.push(name);
        const body = field(node, "body");
        if (body && owner !== null) { out.types[owner].constantBodies = true; addType(node, "anonymous", null, body, [{ index: owner }], true); }
      } else if (type === "method_declaration") {
        const owner = ownerOf(node), name = identifier(field(node, "name"), text);
        const parameters = children(field(node, "parameters")).filter(item => item.type === "formal_parameter" || item.type === "spread_parameter");
        if (owner !== null && isMember(node) && name) out.types[owner].methods.push({ name, arity: parameters.length, varargs: parameters.some(item => item.type === "spread_parameter"), modifiers: javaModifiers(node, text).keywords, startIndex: node.startIndex, line: line(node) });
      } else if (type === "field_declaration" || type === "constant_declaration") {
        const owner = ownerOf(node);
        if (owner !== null && isMember(node)) for (const declarator of namedFields(node, "declarator")) { const name = identifier(field(declarator, "name"), text); if (name) out.types[owner].fields.push(name); }
      } else if (type === "lambda_expression") {
        const parameters = field(node, "parameters");
        if (parameters?.type === "identifier") value(parameters);
        else if (parameters?.type === "inferred_parameters") for (const item of children(parameters)) value(item);
      } else if (type === "type_parameter") {
        const name = identifier(children(node).find(item => item.type === "type_identifier"), text); if (name) typeParameters.add(name);
      } else if ((type === "marker_annotation" || type === "annotation") && JAVA_REWRITERS.test(sourceText(field(node, "name"), text).replace(/\s+/g, ""))) out.rewriting = true;
      if (["variable_declarator", "formal_parameter", "catch_formal_parameter", "enhanced_for_statement", "resource", "instanceof_expression"].includes(type)) value(field(node, "name"));
      // Any pattern may bind; every identifier inside one is treated as a binding.
      if (/pattern/.test(type)) for (const item of descendants(node, child => child.type === "identifier")) value(item);
      if (type === "method_invocation") {
        const call = byKey.get(callKey(node));
        if (call) {
          const object = field(node, "object"), name = identifier(field(node, "name"), text), owner = ownerOf(node);
          const base = { name, arity: children(field(node, "arguments")).filter(item => !/comment/.test(item.type)).length, owner };
          call.callee = owner === null || !name ? null
            : !object ? { form: "simple", ...base }
            : object.type === "this" ? { form: "this", ...base }
            : object.type === "identifier" ? { form: "qualified", qualifier: sourceText(object, text), ...base } : null;
        }
      }
    });
    out.truncated = !complete;
    out.values = [...values]; out.typeParameters = [...typeParameters];
    // A file that is not modelled still declares types of its package; read that package
    // as javac does — escapes translated, comments skipped — or report it unknown.
    if (out.partial) { out.package = javaLexicalPackage(text); out.packageKnown = out.package !== null; }
    return out;
  }
  /** The package clause of a Java compilation unit read in javac's order (JLS 3.3
   *  escapes, 3.4 line ends, 3.7 comments, 7.4): "" for the default package, null when
   *  the head is anything this reader does not follow (an annotation, an error). */
  function javaLexicalPackage(raw) {
    let text = "";
    for (let i = 0, slashes = 0; i < raw.length && text.length < 65536; i++) {
      const c = raw[i];
      if (c === "\\" && slashes % 2 === 0) {
        let j = i + 1; while (raw[j] === "u") j++;
        if (j > i + 1 && /^[0-9a-fA-F]{4}$/.test(raw.slice(j, j + 4))) { text += String.fromCharCode(parseInt(raw.slice(j, j + 4), 16)); i = j + 3; slashes = 0; continue; }
      }
      slashes = c === "\\" ? slashes + 1 : 0;
      text += c;
    }
    let at = 0;
    for (;;) {
      const rest = text.slice(at), space = /^[\s\uFEFF\x1a]+/.exec(rest);
      if (space) { at += space[0].length; continue; }
      if (rest.startsWith("//")) { const end = rest.search(/[\r\n]/); if (end < 0) return ""; at += end; continue; }
      if (rest.startsWith("/*")) { const end = rest.indexOf("*/", 2); if (end < 0) return null; at += end + 2; continue; }
      break;
    }
    const head = text.slice(at);
    if (!/^package\b/.test(head)) return /^(?:import|class|interface|enum|record|abstract|final|public|sealed|non-sealed|strictfp|module|open|;)\b/.test(head) || /^;/.test(head) ? "" : null;
    const clause = /^package((?:\s|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)+)([A-Za-z_$][\w$]*(?:(?:\s|\/\*[\s\S]*?\*\/)*\.(?:\s|\/\*[\s\S]*?\*\/)*[A-Za-z_$][\w$]*)*)(?:\s|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)*;/.exec(head);
    return clause ? clause[2].replace(/\s+|\/\*[\s\S]*?\*\//g, "") : null;
  }
  // C: ISO/IEC 9899:2018 §5.1.1.2 (translation phases), §6.2.1 (scopes), §6.2.2
  // (linkage), §6.10 (preprocessing directives). The preprocessor is not run, so
  // every directive is read lexically — line splices joined, comments skipped,
  // the `%:` digraph accepted — and recorded for src/semantic-calls.js, which
  // abstains whenever a macro could rename, hide or swallow a call.
  const C_DIRECTIVES = new Set(["if", "ifdef", "ifndef", "elif", "elifdef", "elifndef", "else", "endif", "define", "undef", "include", "line", "error", "warning", "pragma", "embed", "ident", "sccs"]);
  const C_NOT_NAMES = new Set(["string_content", "character", "comment", "escape_sequence", "system_lib_string", "preproc_arg", "number_literal"]);
  const C_WORD = /^[A-Za-z_$][\w$]*$/;
  /** Words, token pasting and bracket balance of a macro replacement list. */
  function cMacroShape(tokens) {
    const stack = [], close = { ")": "(", "]": "[", "}": "{" };
    let balanced = true;
    for (const token of tokens) {
      if (token.v === "(" || token.v === "[" || token.v === "{") stack.push(token.v);
      else if (close[token.v] && stack.pop() !== close[token.v]) balanced = false;
    }
    return { paste: tokens.some(token => token.v === "##"), balanced: balanced && !stack.length, words: [...new Set(tokens.filter(token => token.word).map(token => token.v))] };
  }
  function cDirectives(text) {
    // GCC and Clang end a line at a lone CR; this reader and tree-sitter-c do not.
    const out = { macros: [], undefs: [], includes: [], unmodelled: [], conditionals: [], trigraphs: /\?\?[=(/)'<!>-]/.test(text), loneCarriageReturn: /\r(?!\n)/.test(text) };
    // Phase 2 deletes backslash-newline; the deleted positions keep lines physical.
    const splices = []; let removed = 0;
    const s = text.replace(/\\\r?\n/g, (match, offset) => { splices.push(offset - removed); removed += match.length; return ""; });
    const n = s.length, newlines = [];
    for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) newlines.push(i);
    const below = (list, value) => { let lo = 0, hi = list.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < value) lo = mid + 1; else hi = mid; } return lo; };
    const lineOf = index => 1 + below(newlines, index) + below(splices, index + 1);
    const blank = c => c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v";
    function comment(i) {
      if (s[i] !== "/") return i;
      if (s[i + 1] === "*") { const end = s.indexOf("*/", i + 2); return end < 0 ? n : end + 2; }
      if (s[i + 1] === "/") { const end = s.indexOf("\n", i); return end < 0 ? n : end; }
      return i;
    }
    function quoted(i) {
      const quote = s[i];
      for (i++; i < n; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === quote) return i + 1; if (s[i] === "\n") return i; }
      return n;
    }
    const PUNCT = { "##": "##", "%:": "#", "<%": "{", "%>": "}", "<:": "[", ":>": "]" };
    const open = [];
    function directive(start, line) {
      const tokens = []; let i = start;
      while (i < n && s[i] !== "\n") {
        const c = s[i];
        if (blank(c)) { i++; continue; }
        const skipped = comment(i); if (skipped !== i) { i = skipped; continue; }
        let end;
        if (/[A-Za-z_$]/.test(c)) { end = i + 1; while (end < n && /[\w$]/.test(s[end])) end++; tokens.push({ v: s.slice(i, end), word: true, start: i, end }); }
        else if (c === "\"" || c === "'") { end = quoted(i); tokens.push({ v: s.slice(i, end), start: i, end }); }
        else if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(s[i + 1] || "")) { end = i + 1; while (end < n && (/[\w.$]/.test(s[end]) || /[+-]/.test(s[end]) && /[eEpP]/.test(s[end - 1]))) end++; tokens.push({ v: s.slice(i, end), start: i, end }); }
        else if (s.startsWith("%:%:", i)) { end = i + 4; tokens.push({ v: "##", start: i, end }); }
        else { const two = s.slice(i, i + 2); end = i + (PUNCT[two] ? 2 : 1); tokens.push({ v: PUNCT[two] || c, start: i, end }); }
        i = end;
      }
      const head = tokens[0];
      if (!head) return i;
      // `# 12 "file"` is a GNU line marker.
      if (!head.word) { if (!/^[0-9]/.test(head.v)) out.unmodelled.push({ directive: head.v, line }); return i; }
      const name = head.v;
      if (name === "define" || name === "undef") {
        const macro = tokens[1];
        if (!macro?.word) { out.unmodelled.push({ directive: "#" + name, line }); return i; }
        if (name === "undef") { out.undefs.push({ name: macro.v, line }); return i; }
        const functionLike = tokens[2]?.v === "(" && tokens[2].start === macro.end;
        let body = tokens.slice(2);
        if (functionLike) {
          const close = body.findIndex(token => token.v === ")");
          if (close < 0) { out.unmodelled.push({ directive: "#define", line }); return i; }
          body = body.slice(close + 1);
        }
        out.macros.push({ name: macro.v, line, function: functionLike, ...cMacroShape(body) });
      } else if (name === "include") {
        const raw = s.slice(head.end, i).trim(), match = /^(?:"([^"\n]*)"|<([^>\n]*)>)/.exec(raw);
        out.includes.push(match ? { spec: match[1] ?? match[2], system: match[2] !== undefined, line } : { spec: raw.slice(0, 120), computed: true, line });
      } else if (name === "if" || name === "ifdef" || name === "ifndef") open.push(line);
      else if (name === "endif") { if (open.length) out.conditionals.push([open.pop(), line]); }
      else if (!C_DIRECTIVES.has(name)) out.unmodelled.push({ directive: "#" + name, line });
      return i;
    }
    // Phase 3: a comment is one space, so a newline inside a block comment does not
    // start a line; a directive is a `#` that is the first token of its line.
    let lineStart = true;
    for (let i = 0; i < n;) {
      const c = s[i];
      if (c === "\n") { lineStart = true; i++; continue; }
      if (blank(c)) { i++; continue; }
      const skipped = comment(i); if (skipped !== i) { i = skipped; continue; }
      if (lineStart && (c === "#" || c === "%" && s[i + 1] === ":")) { i = directive(i + (c === "#" ? 1 : 2), lineOf(i)); continue; }
      lineStart = false;
      i = c === "\"" || c === "'" ? quoted(i) : i + 1;
    }
    for (const line of open) out.conditionals.push([line, Number.MAX_SAFE_INTEGER]);
    return out;
  }
  /** The name a C declarator declares, and whether it is the plain function shape
   *  `(pointer)* function_declarator(identifier)`; any other shape yields its name only. */
  function cDeclared(declarator, text) {
    let node = declarator?.type === "init_declarator" ? field(declarator, "declarator") : declarator;
    while (node?.type === "pointer_declarator") node = field(node, "declarator");
    if (node?.type === "function_declarator" && field(node, "declarator")?.type === "identifier") return { name: sourceText(field(node, "declarator"), text), shape: "function" };
    for (let n = 0; node && n < 32; n++) {
      if (node.type === "identifier" || node.type === "type_identifier") return { name: sourceText(node, text), shape: "other" };
      node = field(node, "declarator") || children(node).find(item => /declarator$|^(?:type_)?identifier$/.test(item.type)) || null;
    }
    return { name: null, shape: "other" };
  }
  const sameNode = (a, b) => Boolean(a && b) && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;
  /** True for the name a call invokes: `f(…)` or `(f)(…)`. */
  function cCalleePosition(node) {
    let item = node, parent = node.parent;
    while (parent?.type === "parenthesized_expression") { item = parent; parent = parent.parent; }
    return parent?.type === "call_expression" && sameNode(field(parent, "function"), item);
  }
  /** Words of the callee of every call whose arguments contain `node`: if one is a
   *  macro, the expansion may discard, stringise or rewrite the call. */
  function cWithin(node, text) {
    const words = new Set();
    for (let child = node, parent = node.parent; parent && parent.type !== "translation_unit"; child = parent, parent = parent.parent) {
      if (parent.type !== "call_expression" || !sameNode(field(parent, "arguments"), child)) continue;
      for (const word of sourceText(field(parent, "function"), text).match(/[A-Za-z_$][\w$]*/g) || []) words.add(word);
    }
    return [...words];
  }
  function cCallFacts(rootNode, text, calls) {
    const out = { language: "c", partial: Boolean(rootNode.hasError), ...cDirectives(text), globals: [], functions: [], truncated: false };
    const byKey = new Map(calls.map(call => [callKey(call), call]));
    const line = node => node.startPosition.row + 1;
    const isStatic = node => children(node).some(item => item.type === "storage_class_specifier" && sourceText(item, text).trim() === "static");
    const definitions = [];
    const enumerators = (node, conditional) => {
      if (node) for (const item of descendants(node, entry => entry.type === "enumerator")) out.globals.push({ name: sourceText(field(item, "name"), text) || null, kind: "enumerator", static: false, startIndex: item.startIndex, line: line(item), conditional });
    };
    (function fileScope(container, conditional) {
      for (const item of children(container)) {
        if (/^preproc_(?:if|ifdef|elif|elifdef|else)$/.test(item.type)) { fileScope(item, true); continue; }
        if (item.type === "function_definition") {
          const declared = cDeclared(field(item, "declarator"), text);
          out.globals.push({ name: declared.name, kind: declared.shape === "function" ? "definition" : "other", static: isStatic(item), startIndex: item.startIndex, line: line(item), conditional });
          enumerators(field(item, "type"), conditional);
          definitions.push(item);
        } else if (item.type === "declaration" || item.type === "type_definition") {
          for (const decl of namedFields(item, "declarator")) {
            const declared = cDeclared(decl, text);
            out.globals.push({ name: declared.name, kind: item.type === "type_definition" ? "typedef" : declared.shape === "function" ? "prototype" : "object", static: isStatic(item), startIndex: item.startIndex, line: line(decl), conditional });
          }
          enumerators(item, conditional);
        }
      }
    })(rootNode, false);
    // Per function: every identifier-like token (keywords included, for macros named
    // like them) and the names it uses other than as a callee, member or label. The
    // definition's own name is its file-scope declaration, not a local one.
    for (const definition of definitions) {
      const index = out.functions.length, words = new Set(), names = new Set(), stack = [definition];
      let own = field(definition, "declarator"), seen = 0;
      while (own?.type === "pointer_declarator") own = field(own, "declarator");
      own = own?.type === "function_declarator" ? field(own, "declarator") : null;
      while (stack.length) {
        const node = stack.pop();
        if (++seen > 400000) { out.truncated = true; break; }
        const count = node.childCount;
        if (!count) {
          const value = sourceText(node, text);
          if (C_NOT_NAMES.has(node.type) || !C_WORD.test(value)) continue;
          words.add(value);
          if (node.isNamed && !["field_identifier", "statement_identifier"].includes(node.type) && !sameNode(node, own) && !cCalleePosition(node)) names.add(value);
          continue;
        }
        if (node.type === "call_expression") {
          const call = byKey.get(callKey(node)), target = field(node, "function");
          if (call) call.callee = target?.type === "identifier" ? { name: sourceText(target, text), fn: index, within: cWithin(node, text) } : null;
        }
        for (let i = count - 1; i >= 0; i--) stack.push(node.child(i));
      }
      out.functions.push({ startIndex: definition.startIndex, line: line(definition), names: [...names], words: [...words] });
    }
    return out;
  }
  // Kotlin https://kotlinlang.org/spec/overload-resolution.html — which declarations a
  // call without an explicit receiver, or on an object/companion receiver, can name.
  // Recorded: package, imports, top-level declarations with the members of objects,
  // classes and companions, and per call what may shadow it or supply an implicit
  // receiver. A file whose top level holds anything but declarations (and their detached
  // accessors) did not parse as Kotlin, so it is partial.
  const KOTLIN_TOP = new Set(["package_header", "import_list", "import_header", "file_annotation", "shebang_line", "line_comment", "multiline_comment", "class_declaration", "object_declaration", "function_declaration", "property_declaration", "type_alias"]);
  const KOTLIN_MEMBER = new Set(["line_comment", "multiline_comment", "class_declaration", "object_declaration", "function_declaration", "property_declaration", "type_alias", "companion_object", "anonymous_initializer", "secondary_constructor", "enum_entry"]);
  // A type written before a declaration's name is its extension receiver; the grammar wraps
  // it in `receiver_type` (field `receiver`) on functions and properties.
  const KOTLIN_TYPE = new Set(["receiver_type", "user_type", "nullable_type", "parenthesized_type", "function_type", "type_reference", "dynamic"]);
  const KOTLIN_CLASSLIKE = new Set(["class_declaration", "object_declaration", "companion_object"]);
  function kotlinNameNode(node) {
    if (node.type === "property_declaration") return first(first(node, ["variable_declaration"]), ["simple_identifier"]) || null;
    if (node.type === "function_declaration") return first(node, ["simple_identifier"]) || null;
    return first(node, ["type_identifier"]) || null;
  }
  /** A Kotlin identifier as the compiler compares it: `` `foo` `` and `foo` are one name. */
  const kotlinId = (node, text) => sourceText(node, text).replace(/^`([^`]+)`$/, "$1");
  const KOTLIN_ACCESSOR = new Set(["getter", "setter"]);
  /** The property an accessor belongs to. tree-sitter-kotlin parses an accessor written on
   *  its own line as a sibling of its property rather than a child (its `_declaration` rule
   *  accepts a bare getter or setter so that semicolon insertion still works). Kotlin allows
   *  an accessor only directly after its property, so the owner is the nearest preceding
   *  sibling once comments and the property's other accessor are skipped; null when that
   *  sibling is not a property, which means the tree is not one Kotlin would accept. */
  function kotlinAccessorOwner(node) {
    if (node.parent?.type === "property_declaration") return node.parent;
    for (let item = node.previousNamedSibling; item; item = item.previousNamedSibling) {
      if (/comment/.test(item.type) || KOTLIN_ACCESSOR.has(item.type)) continue;
      return item.type === "property_declaration" ? item : null;
    }
    return null;
  }
  /** Context parameters and receivers (`context(a: A) fun f()`) supply implicit receivers
   *  this reader does not model, so a file that spells `context(` in code is partial — also
   *  where the grammar reads it as a plain call. The same text inside a string literal or a
   *  comment is not syntax. */
  function kotlinContextSyntax(rootNode, text) {
    if (!/\bcontext\s*\(/.test(text)) return false;
    const skip = [];
    walk(rootNode, node => { if (/comment|string_literal/.test(node.type)) { skip.push([node.startIndex, node.endIndex]); return false; } });
    for (const match of text.matchAll(/\bcontext\s*\(/g)) if (!skip.some(([from, to]) => match.index >= from && match.index < to)) return true;
    return false;
  }
  /** One declaration: its name, kind, the modifiers that change who can call it, and,
   *  for a class, object or companion, its supertypes and directly declared members. */
  function kotlinDeclaration(node, text, deep) {
    const nameNode = kotlinNameNode(node);
    const kind = { function_declaration: "function", property_declaration: "property", class_declaration: "class", object_declaration: "object", companion_object: "companion", type_alias: "typealias" }[node.type];
    const name = nameNode ? kotlinId(nameNode, text) : node.type === "companion_object" ? "Companion" : null;
    const anchor = node.type === "property_declaration" ? first(node, ["variable_declaration", "multi_variable_declaration"]) : nameNode;
    const head = text.slice(node.startIndex, anchor ? anchor.startIndex : node.endIndex);
    let extension = false;
    for (const child of children(node)) { if (anchor && child.startIndex >= anchor.startIndex) break; if (KOTLIN_TYPE.has(child.type)) extension = true; }
    const decl = {
      name, kind, extension, startIndex: node.startIndex, line: node.startPosition.row + 1,
      visibility: /\bprivate\b/.test(head) ? "private" : /\bprotected\b/.test(head) ? "protected" : /\binternal\b/.test(head) ? "internal" : "public",
      platform: /\b(?:expect|actual)\b/.test(head),
      hidden: /@\s*(?:kotlin\s*\.\s*)?Deprecated\b[\s\S]*\bHIDDEN\b/.test(head),
    };
    if (!KOTLIN_CLASSLIKE.has(node.type)) return decl;
    const body = first(node, ["class_body", "enum_class_body"]);
    decl.supertypes = children(node).some(child => /delegation_specifier/.test(child.type));
    decl.flavor = body?.type === "enum_class_body" || /\benum\b/.test(head) ? "enum" : (/\b(annotation|data|value|inline)\b/.exec(head)?.[1] || null);
    decl.known = !node.hasError;
    if (!deep) return decl;
    decl.members = [];
    decl.companion = null;
    for (const parameter of children(first(node, ["primary_constructor"]))) {
      if (parameter.type !== "class_parameter" || !first(parameter, ["binding_pattern_kind"])) continue;
      const id = first(parameter, ["simple_identifier"]);
      if (id) decl.members.push({ name: kotlinId(id, text), kind: "property", extension: false, startIndex: parameter.startIndex, line: parameter.startPosition.row + 1, visibility: "public" });
    }
    for (const child of children(body)) {
      if (KOTLIN_ACCESSOR.has(child.type) && kotlinAccessorOwner(child)) continue;
      if (!KOTLIN_MEMBER.has(child.type)) { decl.known = false; continue; }
      if (/comment|initializer|constructor/.test(child.type)) continue;
      if (child.type === "enum_entry") { decl.members.push({ name: kotlinId(first(child, ["simple_identifier"]), text), kind: "property", extension: false }); continue; }
      const member = kotlinDeclaration(child, text, child.type === "companion_object");
      if (!member.name) { decl.known = false; continue; }
      if (child.type === "companion_object") { if (decl.companion) decl.known = false; decl.companion = member; }
      decl.members.push(member);
    }
    return decl;
  }
  function kotlinCallFacts(rootNode, text, calls) {
    const out = { language: "kotlin", package: "", partial: Boolean(rootNode.hasError) || kotlinContextSyntax(rootNode, text), imports: [], declarations: [], truncated: false };
    for (const top of children(rootNode)) {
      // A property's accessor on its own line declares nothing the file did not already.
      if (KOTLIN_ACCESSOR.has(top.type) && kotlinAccessorOwner(top)) continue;
      if (!KOTLIN_TOP.has(top.type)) { out.partial = true; continue; }
      if (top.type === "package_header") {
        const id = first(top, ["identifier"]);
        out.package = id && !top.hasError ? children(id).map(item => kotlinId(item, text)).join(".") : null;
      } else if (top.type === "import_list" || top.type === "import_header") {
        for (const item of top.type === "import_header" ? [top] : children(top)) {
          if (item.type !== "import_header") continue;
          const id = first(item, ["identifier"]), alias = first(item, ["import_alias"]);
          if (!id || item.hasError) { out.partial = true; continue; }
          out.imports.push({ path: children(id).map(part => kotlinId(part, text)), alias: alias ? kotlinId(children(alias)[0], text) : null, star: Boolean(first(item, ["wildcard_import"])), line: item.startPosition.row + 1 });
        }
      } else if (!/comment|annotation|shebang/.test(top.type)) {
        const decl = kotlinDeclaration(top, text, true);
        if (!decl.name) out.partial = true; else out.declarations.push(decl);
      }
    }
    const found = callNodes(rootNode);
    if (!found) { out.truncated = true; return out; }
    const byKey = new Map(calls.map(call => [call.startIndex + ":" + call.endIndex, call]));
    const classes = new Map(), scopes = new Map();
    const classOf = node => { if (!classes.has(node.id)) classes.set(node.id, kotlinDeclaration(node, text, true)); return classes.get(node.id); };
    for (const node of found) {
      const call = byKey.get(callKey(node));
      if (!call) continue;
      const target = children(node)[0];
      let callee = null;
      if (target?.type === "simple_identifier") callee = { form: "name", name: kotlinId(target, text) };
      else if (target?.type === "navigation_expression") {
        const parts = children(target), selector = children(parts[1]);
        if (parts.length === 2 && parts[0].type === "simple_identifier" && parts[1].type === "navigation_suffix" && selector.length === 1 && selector[0].type === "simple_identifier"
          && text.slice(parts[0].endIndex, selector[0].startIndex).replace(/\s+/g, "") === ".")
          callee = { form: "member", receiver: kotlinId(parts[0], text), name: kotlinId(selector[0], text) };
      }
      if (!callee) { call.callee = null; continue; }
      let outer = null, blocked = null;
      for (let item = node.parent; item && item.type !== "source_file"; item = item.parent) {
        outer = item;
        if (blocked) continue;
        if (item.type === "lambda_literal" || item.type === "anonymous_function") blocked = "The call is inside a lambda or anonymous function, which may run with an implicit receiver whose type the call site does not state";
        else if (item.type === "object_literal") blocked = "The call is inside an object expression, whose supertypes supply implicit-receiver members";
        else if (item.type === "function_declaration" || item.type === "property_declaration") { if (kotlinDeclaration(item, text, false).extension) blocked = "The call is inside an extension declaration, whose receiver type's members and extensions are implicit-receiver candidates"; }
        else if (KOTLIN_ACCESSOR.has(item.type)) {
          // In every accessor, inline or on its own line, `field` is the property's backing
          // field, which outranks every declaration this reader records.
          if ((callee.form === "name" ? callee.name : callee.receiver) === "field") blocked = "The call names field inside a property accessor, where field is the property's backing field";
          // A local variable has no accessors: `get() { … }` after one in a body is a call of get
          // with a trailing lambda, which may run with an implicit receiver.
          else if (item.parent?.type === "statements") blocked = "The call is inside the trailing lambda of a get or set call after a local variable, which may run with an implicit receiver whose type the call site does not state";
          else if (item.parent?.type !== "property_declaration") {
            // A detached accessor runs inside its property, so the property's receiver applies.
            const owner = kotlinAccessorOwner(item);
            if (!owner) blocked = "The call is inside an accessor that follows no property, so the declaration it belongs to is not known";
            else if (kotlinDeclaration(owner, text, false).extension) blocked = "The call is inside an extension declaration, whose receiver type's members and extensions are implicit-receiver candidates";
          }
        }
        else if (KOTLIN_CLASSLIKE.has(item.type)) {
          const decl = classOf(item);
          if (decl.supertypes) blocked = `The call is inside ${decl.name}, which declares supertypes; their inherited members are implicit-receiver candidates that are not read`;
          // The companion object is an implicit receiver throughout its class's body.
          else if (decl.companion && (decl.companion.supertypes || !decl.companion.known)) blocked = `The call is inside ${decl.name}, whose companion object ${decl.companion.supertypes ? "declares supertypes" : "did not parse into declarations only"}; its inherited members are implicit-receiver candidates that are not read`;
          // A data or value class generates copy, componentN, equals, hashCode and toString
          // (the last three are default-import names the resolver never binds); an enum
          // class inherits kotlin.Enum's members.
          else if (decl.flavor === "enum" || decl.flavor === "annotation" || decl.flavor && callee.form === "name" && /^(?:copy|component\d+)$/.test(callee.name))
            blocked = `The call is inside ${decl.flavor} class ${decl.name}, whose generated or inherited members are implicit-receiver candidates`;
          else if (!decl.known) blocked = `The body of ${decl.name} did not parse into declarations only, so its members are not all known`;
        }
      }
      if (!outer) { call.callee = null; continue; }
      if (!scopes.has(outer.id)) scopes.set(outer.id, kotlinDeclared(outer, text));
      const declared = scopes.get(outer.id);
      callee.shadowed = callee.form === "name" ? declared.has(callee.name) : declared.has(callee.receiver) || Boolean(declared.get(callee.name)?.extension);
      if (blocked) callee.blocked = blocked;
      call.callee = callee;
    }
    return out;
  }
  /** Every name declared inside a top-level declaration (its own name excepted):
   *  locals, parameters, members, nested classifiers, with whether it is an extension. */
  function kotlinDeclared(outer, text) {
    const map = new Map();
    const add = (name, extension) => { if (!name) return; const entry = map.get(name) || { extension: false }; entry.extension ||= extension; map.set(name, entry); };
    walk(outer, node => {
      if (node === outer) return;
      const type = node.type;
      if (type === "function_declaration" || type === "property_declaration" || KOTLIN_CLASSLIKE.has(type) || type === "type_alias") {
        const decl = kotlinDeclaration(node, text, false);
        add(decl.name, decl.extension);
      } else if (/parameter|variable_declaration|catch_block|enum_entry/.test(type)) {
        const id = first(node, ["simple_identifier", "type_identifier"]);
        if (id) add(kotlinId(id, text), false);
      }
    });
    return map;
  }

  // Scala: calls are never bound (see scalaBind in src/semantic-calls.js). The facts
  // only place each file's top-level declarations in its package, so a Kotlin or Java
  // absence proof over a mixed JVM package still sees them, and a file this grammar
  // cannot read taints its package instead of disappearing.
  const SCALA_TOP = new Set(["package_clause", "import_declaration", "object_definition", "class_definition", "trait_definition", "function_definition", "function_declaration", "val_definition", "val_declaration", "var_definition", "var_declaration", "type_definition", "package_object", "comment", "block_comment"]);
  const SCALA_KIND = { object_definition: "object", class_definition: "class", trait_definition: "trait", function_definition: "def", function_declaration: "def", val_definition: "val", val_declaration: "val", var_definition: "var", var_declaration: "var", type_definition: "type", package_object: "package-object" };
  function scalaNames(node, text) {
    const name = field(node, "name");
    if (name) return [sourceText(name, text)];
    const pattern = field(node, "pattern");
    if (!pattern) return [];
    return pattern.type === "identifier" ? [sourceText(pattern, text)] : descendants(pattern, item => item.type === "identifier").map(item => sourceText(item, text));
  }
  /** A parse error other than the one this grammar makes on every unit literal: it reads
   *  `()` as a parenthesized expression around a missing identifier. */
  function scalaBroken(node, text) {
    if (!node?.hasError) return false;
    const stack = [node];
    while (stack.length) {
      const item = stack.pop();
      if (item.type === "ERROR") return true;
      if (item.isMissing) {
        const parent = item.parent;
        if (!(item.type === "identifier" && parent?.type === "parenthesized_expression" && /^\(\s*\)$/.test(sourceText(parent, text)))) return true;
        continue;
      }
      for (let i = 0; i < item.childCount; i++) { const child = item.child(i); if (child?.hasError || child?.isMissing) stack.push(child); }
    }
    return false;
  }
  function scalaCallFacts(rootNode, text) {
    const out = { language: "scala", package: "", partial: scalaBroken(rootNode, text), declarations: [], truncated: false };
    let pkg = "";
    for (const top of children(rootNode)) {
      if (!SCALA_TOP.has(top.type)) { out.partial = true; continue; }
      if (top.type === "package_clause") {
        if (field(top, "body")) { out.partial = true; continue; }
        const segments = descendants(field(top, "name"), item => item.type === "identifier").map(item => sourceText(item, text));
        pkg = pkg ? pkg + "." + segments.join(".") : segments.join(".");
      } else if (top.type !== "import_declaration" && !/comment/.test(top.type)) {
        const names = scalaNames(top, text);
        if (!names.length) { out.partial = true; continue; }
        out.declarations.push({ names, kind: SCALA_KIND[top.type], startIndex: top.startIndex, line: top.startPosition.row + 1 });
      }
    }
    out.package = pkg;
    return out;
  }
  /** Outermost `#if … #endif` regions as byte ranges, read from the text so a
   *  directive the grammar keeps as a loose sibling still marks what it encloses.
   *  An unterminated `#if` runs to the end of the file. */
  function directiveRegions(text, rootNode) {
    // A `#if`/`#endif` spelled inside a comment or string literal is text, not a
    // directive; the tree says which spans are comments and strings.
    const skip = [];
    if (rootNode && /#[ \t]*(?:if|endif)\b/.test(text)) walk(rootNode, node => { if (/comment|string/.test(node.type)) { skip.push([node.startIndex, node.endIndex]); return false; } });
    const regions = []; let depth = 0, start = 0;
    for (const match of text.matchAll(/^[ \t]*#[ \t]*(if|endif)\b.*$/gm)) {
      const at = match.index + match[0].indexOf("#");
      if (skip.some(([from, to]) => at >= from && at < to)) continue;
      if (match[1] === "if") { if (!depth++) start = match.index; }
      else if (depth && !--depth) regions.push([start, match.index + match[0].length]);
    }
    if (depth) regions.push([start, text.length]);
    return regions;
  }
  /** A node is conditional when an `#if` region holds it or cuts across it; a node
   *  that merely contains a whole region (a body with an #if inside) is not. */
  const inRegion = (regions, node) => regions.some(([from, to]) => node.startIndex < to && node.endIndex > from && !(node.startIndex <= from && node.endIndex >= to));
  // Swift https://docs.swift.org/swift-book/documentation/the-swift-programming-language/declarations
  // Only one call shape is recorded as bindable: a bare `f(label: arg, …)` written as a
  // statement of a synchronous, unattributed, non-generic top-level function, whose
  // every argument is a parameter of that function declared with a plain type name.
  // The resolver (src/semantic-calls.js, swift-module-function) explains why that is
  // the shape for which imported overloads cannot win; every other call records why.
  /** Attributes the language defines (The Swift Programming Language, "Attributes").
   *  Any other `@Name` may be an attached macro that adds declarations. */
  const SWIFT_BUILTIN_ATTRIBUTES = new Set(["available", "backDeployed", "discardableResult", "dynamicCallable", "dynamicMemberLookup", "frozen", "GKInspectable", "inlinable", "inline", "main", "nonobjc", "NSApplicationMain", "NSCopying", "NSManaged", "objc", "objcMembers", "preconcurrency", "propertyWrapper", "resultBuilder", "requires_stored_property_inits", "testable", "UIApplicationMain", "unchecked", "usableFromInline", "warn_unqualified_access", "IBAction", "IBSegueAction", "IBOutlet", "IBDesignable", "IBInspectable", "globalActor", "retroactive", "Sendable", "escaping", "autoclosure", "convention", "unknown"]);
  /** On the callee or the calling function, only attributes that change neither
   *  overload ranking, isolation nor the body's type checking are accepted. */
  const SWIFT_NEUTRAL_ATTRIBUTES = new Set(["discardableResult", "inlinable", "inline", "usableFromInline"]);
  const SWIFT_COMPOUND = new Set(["if_statement", "guard_statement", "for_statement", "while_statement", "repeat_while_statement", "do_statement"]);
  const swiftName = (node, text) => sourceText(node, text).replace(/^`|`$/g, "");
  const swiftAttributes = (node, text) => children(first(node, ["modifiers"])).filter(item => item.type === "attribute").map(item => sourceText(children(item)[0] || item, text).replace(/\s+/g, ""));
  /** Name, labels, plain parameter types and the features that make a function
   *  unbindable; `problem` names the first such feature. */
  function swiftFunction(node, text) {
    const params = []; let problem = null, async = false, effects = null, last = null;
    const flag = reason => { problem ||= reason; };
    if (field(node, "type_parameters") || first(node, ["type_parameters"])) flag("it is generic, so its parameters are not plain types");
    if (first(node, ["type_constraints"])) flag("it has a where clause");
    for (const name of swiftAttributes(node, text)) if (!SWIFT_NEUTRAL_ATTRIBUTES.has(name)) flag(`it carries @${name}`);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i), label = node.fieldNameForChild(i);
      if (child.type === "async") async = true;
      // `throws(E)` (typed throws) is a named `throws_clause`; plain throws/rethrows are tokens.
      else if (child.type === "throws" || child.type === "throws_clause") effects = sourceText(child, text);
      else if (child.type === "=" || label === "default_value") { if (last) last.defaulted = true; }
      else if (child.type === "parameter") {
        let external = null, internal = null, type = null, variadic = false, modified = null;
        for (let j = 0; j < child.childCount; j++) {
          const part = child.child(j), role = child.fieldNameForChild(j);
          if (role === "external_name") external = swiftName(part, text);
          else if (role === "name" && part.type === "simple_identifier") internal = swiftName(part, text);
          else if (role === "name") type = part.type === "user_type" && children(part).length === 1 && children(part)[0].type === "type_identifier" ? sourceText(children(part)[0], text) : null;
          else if (part.type === "...") variadic = true;
          else if (part.isNamed && !/comment/.test(part.type)) modified ||= part.type.replace(/_/g, " ");
        }
        if (modified) flag(`parameter ${internal || external || "?"} has ${modified}`);
        last = { label: external === "_" ? null : external ?? internal, name: internal, type, variadic, modified, defaulted: false };
        params.push(last);
      }
    }
    if (async) flag("it is async");
    if (effects) flag(`it is marked ${effects}`);
    for (const param of params) {
      if (param.variadic) flag(`parameter ${param.name} is variadic`);
      if (param.defaulted) flag(`parameter ${param.name} has a default argument`);
      if (!param.type) flag(`parameter ${param.name} is not declared with a plain type name`);
    }
    const visibility = children(first(node, ["modifiers"])).find(item => item.type === "visibility_modifier");
    return { params, problem, async, visibility: visibility ? sourceText(visibility, text).replace(/\(.*$/, "") : null };
  }
  /** Why an identifier occurrence in the calling function may bind or rebind the
   *  name, or null when the occurrence can only be a reference, label or member. */
  function swiftOccurrenceProblem(node, caller) {
    const parent = node.parent;
    if (!parent) return "a declaration";
    if (parent.type === "call_expression" && parent.firstNamedChild?.startIndex === node.startIndex) return null;
    if (parent.type === "value_argument_label" || parent.type === "navigation_suffix") return null;
    if (parent.type === "value_argument" && field(parent, "value")?.startIndex === node.startIndex) return null;
    if (parent.type === "navigation_expression" && field(parent, "target")?.startIndex === node.startIndex) return null;
    if (parent.type === "parameter" && parent.parent?.startIndex === caller.startIndex && field(parent, "external_name")?.startIndex === node.startIndex) return null;
    return `a ${parent.type.replace(/_/g, " ")}`;
  }
  /** True when `call` is a statement of the function body, directly or inside
   *  statement-level if/guard/for/while/repeat/do/switch blocks: a position
   *  where its value is discarded and no contextual type reaches it. */
  function swiftStatementPosition(call, body) {
    let node = call;
    for (let depth = 0; depth < 64; depth++) {
      const list = node.parent;
      if (list?.type !== "statements") return false;
      let holder = list.parent;
      if (holder?.startIndex === body.startIndex && holder.type === body.type) return true;
      if (holder?.type === "switch_entry") holder = holder.parent;
      else if (holder?.type === "catch_block") holder = holder.parent;
      if (!holder || !(SWIFT_COMPOUND.has(holder.type) || holder.type === "switch_statement")) return false;
      node = holder;
    }
    return false;
  }
  function swiftCallFacts(rootNode, text, calls) {
    const out = { language: "swift", truncated: false, parseError: Boolean(rootNode.hasError), decls: [], attributes: [], macros: [] };
    const regions = directiveRegions(text, rootNode);
    const line = node => node.startPosition.row + 1;
    const byKey = new Map(calls.map(call => [callKey(call), call]));
    const declare = (name, kind, node, extra = {}) => { if (name) out.decls.push({ name, kind, startIndex: node.startIndex, line: line(node), conditional: inRegion(regions, node), ...extra }); };
    for (const top of children(rootNode)) {
      const type = top.type;
      for (const name of swiftAttributes(top, text)) if (!SWIFT_BUILTIN_ATTRIBUTES.has(name)) out.attributes.push({ name, line: line(top) });
      if (type === "function_declaration") {
        const fn = swiftFunction(top, text);
        declare(swiftName(field(top, "name"), text), "function", top, { params: fn.params, problem: fn.problem, visibility: fn.visibility });
      } else if (type === "class_declaration") {
        const kind = sourceText(field(top, "declaration_kind"), text);
        if (kind === "extension") continue;
        const visibility = children(first(top, ["modifiers"])).find(item => item.type === "visibility_modifier");
        declare(swiftName(field(top, "name"), text), "type", top, { typeKind: kind, generic: Boolean(first(top, ["type_parameters"])), visibility: visibility ? sourceText(visibility, text).replace(/\(.*$/, "") : null });
      } else if (type === "protocol_declaration" || type === "typealias_declaration") {
        declare(swiftName(field(top, "name"), text), "type", top, { typeKind: type === "protocol_declaration" ? "protocol" : "typealias" });
      } else if (type === "macro_declaration") {
        declare(swiftName(first(top, ["simple_identifier"]), text), "macro", top);
      } else if (["import_declaration", "operator_declaration", "precedence_group_declaration", "directive", "comment", "multiline_comment"].includes(type)) {
        continue;
      } else {
        // Property bindings and main.swift top-level code: an identifier written there
        // other than as a callee, argument, label or member may declare a module-level
        // value (a global `let`, a top-level `guard let`), so each counts as one.
        if (type !== "property_declaration") out.macros.push(...descendants(top, node => /macro_invocation|macro_expansion/.test(node.type)).map(node => ({ line: line(node) })));
        const seen = new Set();
        walk(top, node => {
          if (node.type !== "simple_identifier" || !swiftOccurrenceProblem(node, rootNode)) return;
          const name = swiftName(node, text);
          if (!seen.has(name)) { seen.add(name); declare(name, type === "property_declaration" ? "variable" : "code", top); }
        });
      }
    }
    const found = callNodes(rootNode);
    if (!found) { out.truncated = true; return out; }
    for (const node of found) {
      const call = byKey.get(callKey(node));
      if (call) call.callee = swiftCallee(node, text, regions);
    }
    return out;
  }
  function swiftCallee(node, text, regions) {
    const refused = reason => ({ refused: reason });
    const head = node.firstNamedChild;
    if (head?.type !== "simple_identifier") return refused("The callee is a member access, an optional chain or an expression; only a bare function name is bound, because a receiver's static type is not proven");
    const name = swiftName(head, text);
    if (/^\$/.test(name)) return refused(`${name} is a projected or anonymous closure value, not a declaration`);
    let caller = null;
    for (let item = node.parent; item; item = item.parent) {
      if (["class_declaration", "protocol_declaration", "class_body", "protocol_body", "enum_class_body"].includes(item.type)) return refused("The call is inside a type or extension, where unqualified lookup searches the members of Self — inherited and protocol-extension members included, possibly from other modules — before module scope");
      if (item.type === "lambda_literal") return refused("The call is inside a closure, which may be a result-builder body or a single-expression closure whose contextual type selects among overloads");
      if (item.type === "catch_block" && name === "error" && !field(item, "error")) return refused("The call is inside a catch block without a pattern, which binds an implicit local `error`");
      if (item.type === "function_declaration") { if (caller) return refused("The call is inside a nested function, whose enclosing function's locals are not followed"); caller = item; }
    }
    if (!caller) return refused("The call is module-level code, whose top-level variables are globals visible across the module");
    if (caller.parent?.type !== "source_file") return refused("The calling function is not declared at module level");
    const fn = swiftFunction(caller, text);
    if (fn.params.some(param => param.name === name)) return refused(`The calling function has a parameter named ${name}, which shadows the module-level function (a callAsFunction or @dynamicCallable value may be called)`);
    if (first(caller, ["type_parameters"])) return refused("The calling function is generic, so a parameter type name may be a generic parameter");
    const attribute = swiftAttributes(caller, text).find(item => !SWIFT_NEUTRAL_ATTRIBUTES.has(item));
    if (attribute) return refused(`The calling function carries @${attribute}, which may be a result builder, a global actor or a macro that rewrites its body`);
    if (fn.async) return refused("The calling function is async, and Swift's overload ranking prefers async overloads in async contexts");
    const body = field(caller, "body"), statements = first(body, ["statements"]);
    if (!body || !statements || !swiftStatementPosition(node, body)) return refused("The call is not a statement of the calling function's body; as part of an expression, its contextual type may select among overloads");
    // Statements inside #if count only in some configurations; the body may be a
    // single expression (an implicit return) in the others.
    if (children(statements).filter(item => item.type !== "directive" && !/comment/.test(item.type) && !inRegion(regions, item)).length < 2) return refused("The calling function's body is a single expression in some configuration, which is an implicit return with a contextual type");
    const suffix = children(node).find(item => item.type === "call_suffix");
    const parts = children(suffix);
    if (parts.length !== 1 || parts[0].type !== "value_arguments") return refused("The call has a trailing closure; which parameter it fills is decided by overload resolution");
    const args = children(parts[0]).filter(item => item.type === "value_argument");
    if (!args.length) return refused("The call has no argument whose type is written in the source; an imported overload of the same name with another result type is not excluded");
    const labels = [], types = [], names = [];
    for (const arg of args) {
      const label = first(arg, ["value_argument_label"]), value = field(arg, "value");
      if (value?.type !== "simple_identifier" || children(arg).length !== (label ? 2 : 1)) return refused("An argument is not a bare parameter name of the calling function, so its static type is not written in the source");
      const argName = swiftName(value, text), param = fn.params.filter(item => item.name === argName);
      if (param.length !== 1 || !param[0].type || param[0].variadic || param[0].modified) return refused(`Argument ${argName} is not a parameter of the calling function declared with a plain type name${param[0]?.modified ? ` (it has ${param[0].modified})` : ""}`);
      labels.push(label ? swiftName(label, text) : null); types.push(param[0].type); names.push(argName);
    }
    // Every other occurrence of the callee name or an argument name in the calling
    // function must be a reference, label or member; a binding there would shadow it.
    const watched = new Set([name, ...names]);
    const nameNode = field(caller, "name");
    let problem = null;
    walk(caller, item => {
      if (problem) return false;
      if (item.type === "attribute" && item.parent?.parent?.startIndex !== caller.startIndex) { problem = `an attribute (${sourceText(item, text).slice(0, 40)}) inside the calling function may be a macro that adds local declarations`; return false; }
      if (/macro_invocation|macro_expansion/.test(item.type)) { problem = "a freestanding macro inside the calling function may add local declarations"; return false; }
      // A local struct, enum, class, actor, protocol or typealias names itself with a
      // type identifier; one named like the callee makes the call its initializer.
      if (item.type === "type_identifier" && watched.has(swiftName(item, text))) { problem = `${swiftName(item, text)} also occurs as a type name on line ${item.startPosition.row + 1}, which may be a local type whose initializer the call names`; return false; }
      if (item.type !== "simple_identifier") return;
      const value = swiftName(item, text);
      if (!watched.has(value) || item.startIndex === nameNode?.startIndex) return;
      if (item.parent?.type === "parameter" && item.parent.parent?.startIndex === caller.startIndex && names.includes(value) && field(item.parent, "external_name")?.startIndex !== item.startIndex) return;
      const where = swiftOccurrenceProblem(item, caller);
      if (where) problem = `${value} also occurs as ${where} on line ${item.startPosition.row + 1}, which may bind it in the calling function`;
    });
    if (problem) return refused(`The call is not bound: ${problem}`);
    return { name, labels, types, args: names, caller: { startIndex: caller.startIndex, line: caller.startPosition.row + 1, name: swiftName(nameNode, text) } };
  }
  // C# https://learn.microsoft.com/dotnet/csharp/language-reference/language-specification/expressions#1284-simple-names
  // Recorded: every type declaration with its namespace, enclosing type, modifiers,
  // base list, primary-constructor parameters and named members (methods with their
  // parameter lists), and per `Type.M(args)` call what may bind `Type` locally and
  // the proven static type of every argument. src/semantic-calls.js decides.
  const CSHARP_TYPE_DECLARATIONS = { class_declaration: "class", struct_declaration: "struct", record_declaration: "record", record_struct_declaration: "record struct", interface_declaration: "interface", enum_declaration: "enum", delegate_declaration: "delegate" };
  const CSHARP_SKIPPED_MEMBERS = new Set(["constructor_declaration", "destructor_declaration", "operator_declaration", "conversion_operator_declaration", "indexer_declaration", "comment", "if_directive", "elif_directive", "else_directive", "endif_directive", "region_directive", "endregion_directive", "define_directive", "undef_directive", "nullable_directive", "pragma_directive", "warning_directive", "error_directive", "line_directive", "preproc_if", "attribute_list"]);
  /** Names that are implicit parameters or contextual keywords where a type name could stand. */
  const CSHARP_CONTEXTUAL = new Set(["value", "field", "args", "nameof", "var", "dynamic", "global", "_"]);
  /** Identifier occurrences that are a type name or a member access on it, never a binding. */
  function csharpTypePosition(node) {
    const parent = node.parent, is = name => field(parent, name)?.startIndex === node.startIndex;
    if (!parent) return false;
    if (parent.type === "member_access_expression") return is("expression") || is("name");
    if (["variable_declaration", "parameter", "object_creation_expression", "array_type", "cast_expression", "declaration_pattern", "declaration_expression", "method_declaration", "local_function_statement", "property_declaration", "event_declaration", "indexer_declaration", "operator_declaration", "delegate_declaration"].includes(parent.type)) return is("type");
    if (parent.type === "type_argument_list") return true;
    return ["nullable_type", "typeof_expression", "qualified_name"].includes(parent.type) && parent.firstNamedChild?.startIndex === node.startIndex;
  }
  /** Identifier occurrences that read a value; a parameter read there keeps its declared type. */
  const CSHARP_READS = new Set(["argument", "binary_expression", "return_statement", "equals_value_clause", "interpolation", "parenthesized_expression", "conditional_expression", "arrow_expression_clause", "element_access_expression", "prefix_unary_expression", "postfix_unary_expression", "expression_statement", "if_statement", "while_statement"]);
  function csharpParameters(list, text) {
    const params = []; let paramsArray = null, pendingArray = false;
    const keyword = node => node?.type === "predefined_type" ? sourceText(node, text)
      : node?.type === "nullable_type" && children(node)[0]?.type === "predefined_type" && children(node).length === 1 ? sourceText(children(node)[0], text) + "?" : null;
    for (let i = 0; i < (list?.childCount || 0); i++) {
      const child = list.child(i);
      if (child.type === "params") { pendingArray = true; continue; }
      if (pendingArray && child.type === "array_type") {
        const rank = field(child, "rank");
        paramsArray = { element: rank && sourceText(rank, text).replace(/\s+/g, "") === "[]" ? keyword(field(child, "type")) : null };
        continue;
      }
      if (child.type !== "parameter") continue;
      const modifiers = children(child).filter(item => item.type === "parameter_modifier").map(item => sourceText(item, text));
      if (modifiers.includes("params") || /^\s*params\b/.test(sourceText(child, text))) {
        const type = field(child, "type");
        paramsArray = { element: type?.type === "array_type" && sourceText(field(type, "rank"), text).replace(/\s+/g, "") === "[]" ? keyword(field(type, "type")) : null };
        continue;
      }
      params.push({ name: sourceText(field(child, "name"), text), type: keyword(field(child, "type")), optional: Boolean(first(child, ["equals_value_clause"])), modifiers: modifiers.filter(item => item !== "this"), attributes: Boolean(first(child, ["attribute_list"])) });
    }
    return { params, paramsArray };
  }
  function csharpCallFacts(rootNode, text, calls) {
    const out = { language: "c_sharp", truncated: false, parseError: Boolean(rootNode.hasError), types: [], namespaces: [], topLevelStatements: false };
    const regions = directiveRegions(text, rootNode);
    const line = node => node.startPosition.row + 1;
    const modifiersOf = node => children(node).filter(item => item.type === "modifier").map(item => sourceText(item, text));
    const declareNamespace = name => { const parts = name.split("."); for (let i = 1; i <= parts.length; i++) out.namespaces.push(parts.slice(0, i).join(".")); };
    function typeFact(node, namespace, outer) {
      const kind = CSHARP_TYPE_DECLARATIONS[node.type];
      const bases = children(field(node, "bases")).filter(item => !/comment/.test(item.type));
      const head = bases[0]?.type === "primary_constructor_base_type" ? children(bases[0])[0] : bases[0];
      const fact = {
        key: node.startIndex, name: sourceText(field(node, "name"), text), kind, namespace, outer: outer?.key ?? null,
        typeParams: children(field(node, "type_parameters")).map(item => sourceText(field(item, "name") || item, text)),
        modifiers: modifiersOf(node), attributes: Boolean(first(node, ["attribute_list"])),
        base: !bases.length ? null : head?.type === "identifier" ? { name: sourceText(head, text) } : { complex: sourceText(head || bases[0], text).slice(0, 80) },
        primaryParams: children(field(node, "parameters")).filter(item => item.type === "parameter").map(item => sourceText(field(item, "name"), text)),
        startIndex: node.startIndex, line: line(node), conditional: inRegion(regions, node), members: [], unknownMembers: [],
      };
      out.types.push(fact);
      const body = field(node, "body");
      for (const item of children(body)) {
        const member = (name, memberKind, extra = {}) => fact.members.push({ name, kind: memberKind, modifiers: modifiersOf(item), attributes: Boolean(first(item, ["attribute_list"])), startIndex: item.startIndex, line: line(item), conditional: inRegion(regions, item), ...extra });
        if (CSHARP_TYPE_DECLARATIONS[item.type]) {
          const nested = typeFact(item, namespace, fact);
          member(nested.name, "type", { arity: nested.typeParams.length });
        } else if (item.type === "method_declaration") {
          member(sourceText(field(item, "name"), text), "method", { arity: children(field(item, "type_parameters")).length, explicit: Boolean(first(item, ["explicit_interface_specifier"])), ...csharpParameters(field(item, "parameters"), text) });
        } else if (item.type === "field_declaration" || item.type === "event_field_declaration") {
          for (const declarator of descendants(first(item, ["variable_declaration"]), node => node.type === "variable_declarator")) member(sourceText(field(declarator, "name") || children(declarator)[0], text), item.type === "field_declaration" ? "field" : "event");
        } else if (item.type === "property_declaration" || item.type === "event_declaration") {
          member(sourceText(field(item, "name"), text), item.type === "property_declaration" ? "property" : "event");
        } else if (item.type === "enum_member_declaration") {
          member(sourceText(field(item, "name"), text), "enum member");
        } else if (!CSHARP_SKIPPED_MEMBERS.has(item.type) && !/directive|comment/.test(item.type)) fact.unknownMembers.push({ type: item.type, line: line(item) });
      }
      return fact;
    }
    (function visit(container, namespace) {
      for (const item of children(container)) {
        if (item.type === "namespace_declaration" || item.type === "file_scoped_namespace_declaration") {
          const name = sourceText(field(item, "name"), text).replace(/\s+/g, ""), full = namespace ? namespace + "." + name : name;
          declareNamespace(full);
          visit(item.type === "namespace_declaration" ? field(item, "body") : item, full);
        } else if (CSHARP_TYPE_DECLARATIONS[item.type]) typeFact(item, namespace, null);
        else if (item.type === "global_statement") out.topLevelStatements = true;
      }
    })(rootNode, "");
    const byKey = new Map(calls.map(call => [callKey(call), call]));
    const found = []; let complete = walk(rootNode, node => { if (node.type === "invocation_expression") found.push(node); });
    if (!complete) { out.truncated = true; return out; }
    const occurrences = new Map();
    for (const node of found) {
      const call = byKey.get(callKey(node));
      if (call) call.callee = csharpCallee(node, text, occurrences);
    }
    return out;
  }
  function csharpCallee(node, text, occurrences) {
    const refused = reason => ({ refused: reason });
    const fn = field(node, "function");
    if (fn?.type !== "member_access_expression") return refused(fn?.type === "identifier" ? "An unqualified call may name a method of the enclosing types, their bases, a local function or a `using static` import; only `Type.M(…)` is bound" : "The callee is not of the form `Type.M(…)`");
    const head = field(fn, "expression"), member = field(fn, "name");
    if (member?.type !== "identifier") return refused("The method is called with explicit type arguments or is not a plain name; generic inference is not evaluated");
    if (head?.type !== "identifier") return refused("The receiver is not a single type name (a qualified name, an alias-qualified name or an expression)");
    const type = sourceText(head, text), method = sourceText(member, text);
    if (CSHARP_CONTEXTUAL.has(type)) return refused(`${type} is an implicit parameter or contextual keyword there, not a type name`);
    // The member that holds the call, and the types and namespace around it.
    let scope = null, inTopLevel = false;
    const enclosing = [];
    for (let item = node; item; item = item.parent) {
      if (item.type === "global_statement") inTopLevel = true;
      if (!scope && item.parent?.type === "declaration_list") scope = item;
      if (CSHARP_TYPE_DECLARATIONS[item.type]) {
        if (item.type === "interface_declaration") return refused("The call is inside an interface, where inherited interface members are in scope");
        enclosing.push(item.startIndex);
      }
    }
    let namespace = "";
    for (let item = node.parent; item; item = item.parent) if (item.type === "namespace_declaration" || item.type === "file_scoped_namespace_declaration") namespace = sourceText(field(item, "name"), text).replace(/\s+/g, "") + (namespace ? "." + namespace : "");
    let unit = node; while (unit.parent) unit = unit.parent;
    const scopes = inTopLevel ? children(unit).filter(item => item.type === "global_statement") : scope ? [scope] : null;
    if (!scopes) return refused("The call is not inside a member or top-level statements");
    // Arguments: positional, no ref/out/in, each a literal or a parameter of the member.
    const parameters = scope ? children(field(scope, "parameters")).filter(item => item.type === "parameter") : [];
    const args = [], watched = new Map([[type, "type"]]);
    for (const arg of children(field(node, "arguments")).filter(item => item.type === "argument")) {
      const value = children(arg).at(-1);
      if (first(arg, ["name_colon"])) return refused("A named argument is used; argument-to-parameter mapping by name is not evaluated");
      if (!value || sourceText(arg, text).trim() !== sourceText(value, text).trim()) return refused("An argument is passed by ref, out or in");
      const raw = sourceText(value, text);
      if (value.type === "integer_literal") {
        const digits = raw.replace(/_/g, "");
        const number = /^0[xX][0-9a-fA-F]+$/.test(digits) ? parseInt(digits.slice(2), 16) : /^[0-9]+$/.test(digits) ? Number(digits) : NaN;
        if (!(number <= 2147483647)) return refused(`Argument ${raw} is an integer literal with a suffix or outside int, whose conversions are not tabulated`);
        args.push({ kind: "int", text: raw });
      } else if (value.type === "real_literal") args.push({ kind: /[fF]$/.test(raw) ? "float" : /[mM]$/.test(raw) ? "decimal" : "double", text: raw });
      else if (["string_literal", "verbatim_string_literal", "raw_string_literal"].includes(value.type)) args.push({ kind: "string", text: raw.slice(0, 40) });
      else if (value.type === "boolean_literal") args.push({ kind: "bool", text: raw });
      else if (value.type === "character_literal") args.push({ kind: "char", text: raw });
      else if (value.type === "identifier") {
        const declared = parameters.filter(item => sourceText(field(item, "name"), text) === raw);
        const typeNode = field(declared[0], "type");
        const keyword = typeNode?.type === "predefined_type" ? sourceText(typeNode, text) : typeNode?.type === "nullable_type" && children(typeNode)[0]?.type === "predefined_type" ? sourceText(children(typeNode)[0], text) + "?" : null;
        if (declared.length !== 1 || !keyword || children(declared[0]).some(item => item.type === "parameter_modifier" || item.type === "attribute_list")) return refused(`Argument ${raw} is not a parameter of the enclosing member declared with a predefined type`);
        if (raw === type) return refused(`${type} is a parameter of the enclosing member`);
        args.push({ kind: "param", type: keyword, text: raw, line: declared[0].startPosition.row + 1 });
        watched.set(raw, declared[0].startIndex);
      } else return refused(`Argument ${raw.slice(0, 40)} is not a literal or a parameter with a predefined type, so its static type is not proven`);
    }
    // Identifier occurrences of the scope, indexed once per scope by name.
    const key = inTopLevel ? "top" : scopes[0].startIndex;
    if (!occurrences.has(key)) {
      const index = new Map();
      const complete = scopes.every(top => walk(top, item => { if (item.type === "identifier") { const name = sourceText(item, text), list = index.get(name) || []; list.push(item); index.set(name, list); } }));
      occurrences.set(key, complete ? index : null);
    }
    const index = occurrences.get(key);
    if (!index) return refused("The member holding the call is larger than the extraction ceiling");
    let problem = null;
    for (const [name, kind] of watched) for (const item of index.get(name) || []) {
      if (problem) break;
      if (kind === "type") {
        if (!csharpTypePosition(item)) problem = `${name} also occurs as ${item.parent?.type.replace(/_/g, " ")} on line ${line(item)}, which may declare a local, parameter, lambda parameter, pattern or range variable of that name`;
        continue;
      }
      if (item.parent?.type === "parameter" && item.parent.startIndex === kind) continue;
      const parent = item.parent;
      const read = parent && (CSHARP_READS.has(parent.type) || parent.type === "member_access_expression" && field(parent, "expression")?.startIndex === item.startIndex || parent.type === "assignment_expression" && field(parent, "right")?.startIndex === item.startIndex || parent.type === "invocation_expression" && field(parent, "function")?.startIndex === item.startIndex);
      if (!read && !(parent?.type === "member_access_expression" && field(parent, "name")?.startIndex === item.startIndex)) problem = `${name} also occurs as ${parent?.type.replace(/_/g, " ")} on line ${line(item)}, which may rebind it`;
    }
    if (problem) return refused(`The call is not bound: ${problem}`);
    return { type, method, args, enclosing, namespace, topLevel: inTopLevel };
    function line(item) { return item.startPosition.row + 1; }
  }
  /* The bundled tree-sitter-rust lexes the first line of a leading `#![` as a shebang
     token, so a first inner attribute that spans several lines (`#![allow(\n …\n)]`)
     leaves ERROR siblings behind it. A tree whose only errors are those siblings, with
     the attribute's brackets balanced and closed by `]`, holds every item intact. */
  function rustAttributeMisparse(rootNode, text) {
    const top = children(rootNode);
    if (top[0]?.type !== "shebang" || !/^#!\[/.test(sourceText(top[0], text))) return false;
    let last = 0;
    while (top[last + 1]?.type === "ERROR") last++;
    if (!last) return false;
    const attribute = text.slice(top[0].startIndex, top[last].endIndex).replace(/"(?:[^"\\]|\\.)*"/g, '""');
    let depth = 0;
    for (const char of attribute) { if ("([{".includes(char)) depth++; else if (")]}".includes(char) && --depth < 0) return false; }
    if (depth !== 0 || !/\]\s*$/.test(attribute)) return false;
    return top.slice(last + 1).every(item => !item.hasError && !item.isMissing);
  }
  function callBindingFacts(rootNode, text, language, calls) {
    // A tree with error-recovery nodes may have swallowed exactly the declaration a
    // shadowing or glob rule reasons about, so Go and Rust facts from such a tree are
    // marked partial and never feed an absence-based conclusion.
    if (language === "go" || language === "rust") {
      const facts = language === "go" ? goCallFacts(rootNode, text, calls) : rustCallFacts(rootNode, text, calls);
      if (rootNode.hasError && !(language === "rust" && rustAttributeMisparse(rootNode, text))) facts.partial = true;
      // A partial file still states the `mod` declarations it parsed; a module file
      // they name has that file as a parent, and an error region may hide more.
      if (facts.partial && language === "rust") facts.errorMentionsMod = descendants(rootNode, node => node.type === "ERROR" || node.isMissing).some(node => /\bmod\b/.test(sourceText(node, text)));
      return facts;
    }
    if (language === "java") return javaCallFacts(rootNode, text, calls);
    if (language === "c") return cCallFacts(rootNode, text, calls);
    if (language === "kotlin") return kotlinCallFacts(rootNode, text, calls);
    if (language === "scala") return scalaCallFacts(rootNode, text, calls);
    if (language === "swift") return swiftCallFacts(rootNode, text, calls);
    if (language === "c_sharp") return csharpCallFacts(rootNode, text, calls);
    return null;
  }
  function extract(tree, source, suppliedLanguage, path = "") {
    const text = String(source ?? "");
    const S = root.SkylenseSourceContracts;
    if (S?.usingLineIndex) return S.usingLineIndex(text, () => extractFromTree(tree, text, suppliedLanguage, path));
    return extractFromTree(tree, text, suppliedLanguage, path);
  }
  function extractFromTree(tree, text, suppliedLanguage, path = "") {
    const language = ALIASES[suppliedLanguage] || suppliedLanguage;
    const grammarLanguage = language === "tsx" ? "typescript" : language;
    if (!tree?.rootNode || !Number.isInteger(tree.rootNode.startIndex)) throw new Error("A parsed Tree-sitter tree is required.");
    const requireShadowed = JS.has(language) ? requireShadowScopes(tree, text) : () => false;
    const symbols = [], imports = [], calls = [], diagnostics = [], embedded = [], relationships = [], seenReferences = new Set(), seenNodes = new Set(), headers = new Map();
    const julia = { bindings: [], exports: [], dynamicScopes: [] }, moduleBindings = new Set(); let moduleBindingsDynamic = false;
    let phpNamespace = ""; const phpNamesSeen = new Set(), shellPending = [];
    const stack = [{ node: tree.rootNode, owner: null, suppressed: false, conditional: false, deferred: false }]; let visited = 0;
    function reference(node, specifier, form, extra = {}) {
      if (!specifier || node.hasError || /[\u0000-\u001f]/.test(specifier)) return;
      const key = `${node.startIndex}:${form}:${specifier}`; if (seenReferences.has(key)) return; seenReferences.add(key);
      imports.push({ specifier, form, line: node.startPosition.row + 1, endLine: lastLine(node), column: node.startPosition.column, startIndex: node.startIndex, endIndex: node.endIndex, ...extra });
    }
    function importFacts(node, owner, conditional) {
      if (node.hasError) return;
      const type = node.type;
      if (language === "python" && ["import_statement", "import_from_statement"].includes(type)) {
        // A module name is one logical dotted name. Explicit line joining and
        // whitespace around the dots are layout, not part of any name.
        // https://docs.python.org/3/reference/lexical_analysis.html#explicit-line-joining
        const dotted = node => sourceText(node, text).replace(/\\[\r\n]+|\s+/g, "");
        if (type === "import_from_statement") {
          const module = dotted(field(node, "module_name")), imported = children(node).filter(child => child.id !== field(node, "module_name")?.id);
          const names = imported.map(child => sourceText(field(child, "name") || child, text)).filter(Boolean);
          reference(node, module, "python-from", { names });
        } else for (const child of children(node)) reference(node, dotted(field(child, "name") || child), "python-import", { names: [] });
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
          if (args.length === 1 && !(callee === "require" && requireShadowed(node))) {
            const specifier = literal(args[0], text, language);
            // A computed specifier is decided when the expression runs. It is
            // reported as one unsupported reference instead of disappearing.
            if (specifier) reference(node, specifier, "js-import");
            else reference(node, sourceText(args[0], text).replace(/\s+/g, " ").trim().slice(0, 120), callee === "require" ? "commonjs-expression" : "dynamic-expression");
          }
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
        if (["include_expression", "include_once_expression", "require_expression", "require_once_expression"].includes(type)) {
          let argument = children(node)[0];
          while (argument && argument.type === "parenthesized_expression") argument = children(argument).find(child => child.type !== "(" && child.type !== ")" && !/comment/.test(child.type));
          const plain = literal(argument, text, language);
          if (plain) reference(node, plain, "php-include");
          else {
            const anchored = phpAnchoredInclude(argument, text, phpNamespace);
            if (anchored) reference(node, sourceText(argument, text).replace(/\s+/g, " ").slice(0, 240), "php-include", { anchor: "file-dir", path: anchored.path, via: anchored.via, ...(anchored.caveat ? { caveat: anchored.caveat } : {}) });
          }
        }
        if (type === "namespace_definition") phpNamespace = sourceText(field(node, "name"), text).replace(/^\\/, "");
        if (type === "namespace_use_declaration") {
          // https://www.php.net/manual/en/language.namespaces.importing.php
          const declared = sourceText(node, text), group = first(node, ["namespace_use_group"]);
          const declaredKind = /^use\s+function\b/i.test(declared) ? "function" : /^use\s+const\b/i.test(declared) ? "const" : "class";
          const prefix = group ? sourceText(first(node, ["namespace_name", "qualified_name"]), text).replace(/^\\/, "") : "";
          const clauses = group ? children(group) : children(node).filter(child => child.type === "namespace_use_clause");
          for (const clause of clauses) {
            const parts = children(clause), target = parts.find(part => part.type !== "namespace_aliasing_clause"), aliasing = parts.find(part => part.type === "namespace_aliasing_clause");
            const clauseText = sourceText(clause, text), name = sourceText(target, text).replace(/\s+/g, "").replace(/^\\/, "");
            if (!name) continue;
            const useKind = /^function\b/i.test(clauseText) ? "function" : /^const\b/i.test(clauseText) ? "const" : declaredKind;
            const alias = aliasing ? sourceText(children(aliasing)[0], text) : "";
            reference(clause, prefix ? `${prefix}\\${name}` : name, "php-use", { useKind, namespace: phpNamespace, ...(alias ? { alias } : {}) });
          }
        }
        /* A qualified class name is a module reference only through an autoloader,
           so it is recorded once per namespace and name and bound by the Composer
           family; a single unqualified name is covered by its `use` clause. */
        if (type === "qualified_name" && phpClassPosition(node, text)) {
          const raw = sourceText(node, text).replace(/\s+/g, "");
          if (raw.includes("\\")) {
            const qualified = raw.startsWith("\\") ? "fully" : /^namespace\\/i.test(raw) ? "namespace" : "relative";
            const key = qualified === "fully" ? raw : `${phpNamespace}\0${raw}`;
            if (!phpNamesSeen.has(key)) { phpNamesSeen.add(key); reference(node, raw.replace(/^\\/, ""), "php-name", { qualified, namespace: phpNamespace }); }
          }
        }
      }
      if (language === "swift" && type === "import_declaration") reference(node, sourceText(first(node, ["identifier"]), text), "swift-import");
      if (language === "kotlin" && type === "import_header") reference(node, sourceText(first(node, ["identifier"]), text), "kotlin-import");
      if (language === "scala" && type === "import_declaration") reference(node, sourceText(field(node, "path"), text), "scala-import");
      if (language === "lua" && type === "call" && sourceText(field(node, "function"), text) === "require") {
        let args = children(field(node, "arguments")); if (args.length === 1 && args[0].type === "expression_list") args = children(args[0]);
        if (args.length === 1 && args[0].type === "string") reference(node, literal(args[0], text, language), "lua-require");
      }
      if (language === "bash" && type === "command" && ["source", "."].includes(sourceText(field(node, "name"), text))) {
        const argument = field(node, "argument"), plain = literal(argument, text, language);
        if (plain) reference(node, plain, "shell-source", { static: true });
        else if (argument && !argument.hasError) shellPending.push({ node, raw: sourceText(argument, text) });
      }
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
      const { node, owner, suppressed, conditional, deferred } = stack.pop(); if (!node) continue;
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
          const contract = signatureContract(node, text, grammarLanguage, declared, path);
          symbols.push({ index, name: declared.name, qualifiedName: owner === null ? declared.name : `${symbols[owner].qualifiedName}.${declared.name}`, kind: declared.kind, line, endLine, bodyEndLine: lastLine(node), parent: owner, column: node.startPosition.column, nameLine: anchor.startPosition.row + 1, nameColumn: anchor.startPosition.column, nameStartIndex: anchor.startIndex, startIndex: node.startIndex, endIndex: node.endIndex, ...(declared.body ? { bodyStartIndex: declared.body.startIndex, bodyEndIndex: declared.body.endIndex } : {}), evidenceStatus: "syntax-tree", nodeType: node.type, conditional, inputs: contract.inputs, outputs: contract.outputs, sourceContract: contract.sourceContract, ...(contract.summary ? { summary: contract.summary } : {}) }); currentOwner = index;
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
      // `@name` applies that callable to the declaration below it at definition time. It is
      // a reference from the enclosing scope, never the decorated declaration itself, and
      // `@name(...)` is already a call expression handled below.
      if (language === "python" && node.type === "decorator") {
        const decorating = children(node)[0], name = decorating && decorating.type !== "call" ? identifier(decorating, text) : null;
        if (name && /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(name)) {
          calls.push({ name, owner, line: node.startPosition.row + 1, endLine: lastLine(node), column: node.startPosition.column, startIndex: node.startIndex, endIndex: node.endIndex, calleeKind: "decorator", conditional, resolution: { kind: "unresolved", reason: "Decorator reference; binding requires semantic resolution" }, evidenceStatus: "syntax-tree" });
        }
      }
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
        const target = field(node, "function") || (language === "julia" || language === "swift" || language === "kotlin" ? children(node)[0] : null) || field(node, "name") || field(node, "method");
        // tree-sitter-kotlin reads `f(x) { … }` as a call of the call `f(x)` with a lambda-only
        // suffix; that outer node is the trailing lambda of the same call, not a second call.
        const trailing = language === "kotlin" && target?.type === "call_expression" && !children(children(node)[1]).some(item => item.type === "value_arguments");
        const name = identifier(target, text);
        const header = headers.get(owner), inSignature = language === "julia" && header && node.startIndex >= header[0] && node.endIndex <= header[1];
        // Module-loading names are references, not calls — except on the JVM, where
        // `require(…)` is the standard library's precondition function.
        const loader = language !== "kotlin" && language !== "scala" && ["include", "require", "import", "joinpath"].includes(name);
        if (name && !trailing && !inSignature && !loader) calls.push({ name, owner, line: node.startPosition.row + 1, endLine: lastLine(node), column: node.startPosition.column, startIndex: node.startIndex, endIndex: node.endIndex, calleeKind: target?.type, conditional, ...(deferred ? { deferred: true } : {}), resolution: { kind: "unresolved", reason: "Syntax call site; dispatch and binding require semantic resolution" }, evidenceStatus: "syntax-tree" });
      }
      const list = children(node);
      // A Julia call inside an anonymous function or `do` block is not evaluated where it
      // is written, so include order does not govern it.
      const defersChildren = deferred || language === "julia" && (["arrow_function_expression", "do_clause"].includes(node.type) || node.type === "function_definition" && !declared);
      for (let i = list.length - 1; i >= 0; i--) stack.push({ node: list[i], owner: currentOwner, suppressed: language === "julia" && node.type === "macro_definition", conditional: conditional || ["if_statement", "for_statement", "while_statement", "try_statement", "macrocall_expression"].includes(node.type), deferred: defersChildren });
    }
    const scan = language === "bash" ? shellScan(tree, text) : null;
    if (scan && shellPending.length) shellAnchoredSources(scan, text, shellPending, reference, path);
    // What a file can do to the shell that sources it; the project resolver reads
    // this to decide whether an earlier `source` of this file can be ignored.
    const shell = scan ? { moves: scan.moves.length > 0, sources: scan.sources.length > 0, redefines: scan.redefined?.name || null, partial: Boolean(tree.rootNode.hasError) } : null;
    const structure = { symbols, calls, callableExports: {} };
    const callBinding = callBindingFacts(tree.rootNode, text, language, calls);
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
          const resolution = call.resolution.kind === "local"
            ? (mapping.has(call.resolution.symbol) ? { ...call.resolution, symbol: mapping.get(call.resolution.symbol) } : { kind: "unresolved", reason: "Binding or syntax declaration is ambiguous" })
            : call.resolution;
          syntaxCall.resolution = resolution;
        }
        for (const [name, index] of Object.entries(lexical.callableExports)) if (mapping.has(index)) structure.callableExports[name] = mapping.get(index);
      }
    }
    if (tree.rootNode.hasError && !diagnostics.length) diagnostics.push({ kind: "parse-error", line: 1, endLine: lastLine(tree.rootNode), nodeType: tree.rootNode.type });
    return { symbols, imports, structure, embedded, relationships, ...(callBinding ? { callBinding } : {}), ...(language === "julia" ? { julia } : {}), ...(language === "python" ? { moduleBindings: [...moduleBindings], moduleBindingsDynamic } : {}), ...(shell ? { shell } : {}), parser: { engine: "tree-sitter", language, grammar: language }, status: tree.rootNode.hasError ? "partial" : "analyzed", diagnostics, truncated: false, limitations: [...LIMITATIONS] };
  }
  root.SkylenseSyntaxFacts = Object.freeze({ extract, languages: Object.freeze([...Object.keys(DECLARATIONS), "tsx", "html", "css", "vue", "json", "yaml", "toml"]) });
})(typeof window !== "undefined" ? window : globalThis);
