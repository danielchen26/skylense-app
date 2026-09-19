/* Skylense appearance catalog. Theme changes never alter the graph or reading state. */
(function (root) {
  "use strict";

  const sans = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
  const humanist = '"Avenir Next", Avenir, -apple-system, "Segoe UI", "PingFang SC", sans-serif';
  const compact = '"IBM Plex Sans", Inter, -apple-system, "Segoe UI", "PingFang SC", sans-serif';

  function theme(id, label, description, dark, colors, metrics) {
    return Object.freeze({
      id, label, description, dark,
      colors: Object.freeze(colors),
      preview: Object.freeze([colors.bg, colors.panel, colors.accent, colors.text]),
      metrics: Object.freeze(metrics),
    });
  }

  const catalog = Object.freeze([
    theme("porcelain", "Porcelain · 瓷白", "冷白与石墨，清晰安静的默认工作台。", false, {
      bg: "#F5F7FA", panel: "#FFFFFF", soft: "#EDF1F6", line: "#D4DCE6",
      text: "#202D40", muted: "#536174", accent: "#2456A6", active: "#E7EFFB",
      node: "#FFFFFF", edge: "#728299", accentText: "#FFFFFF", grid: "#CBD4E1",
      focus: "#2456A6", tooltip: "#202D40", tooltipText: "#FFFFFF", overlay: "#15223866",
    }, {
      radius: "8px", radiusSmall: "5px", radiusCard: "12px", font: sans, titleFont: sans,
      shadow: "0 14px 44px #20314F14", shadowSmall: "0 2px 8px #20314F0A", canvasStep: "20px",
    }),
    theme("jade", "Jade · 青玉", "浅玉色纸面与深翠强调，舒展而清爽。", false, {
      bg: "#F2F8F5", panel: "#FCFFFD", soft: "#E8F2ED", line: "#CDDED5",
      text: "#20372D", muted: "#506A5D", accent: "#176B4E", active: "#DEF0E6",
      node: "#FCFFFD", edge: "#708F7E", accentText: "#FFFFFF", grid: "#C4D9CE",
      focus: "#176B4E", tooltip: "#20372D", tooltipText: "#FCFFFD", overlay: "#142E2266",
    }, {
      radius: "10px", radiusSmall: "6px", radiusCard: "15px", font: humanist, titleFont: humanist,
      shadow: "0 14px 44px #1C4D3614", shadowSmall: "0 2px 8px #1C4D360A", canvasStep: "22px",
    }),
    theme("sandstone", "Sandstone · 砂岩", "暖纸与赭石，适合长时间阅读和讲解。", false, {
      bg: "#FAF6EF", panel: "#FFFDF9", soft: "#F3ECE2", line: "#DDD0BF",
      text: "#3D3027", muted: "#705C4C", accent: "#875226", active: "#F3E7D4",
      node: "#FFFDF9", edge: "#97816B", accentText: "#FFFFFF", grid: "#DFD1C0",
      focus: "#875226", tooltip: "#3D3027", tooltipText: "#FFFDF9", overlay: "#34251A66",
    }, {
      radius: "7px", radiusSmall: "4px", radiusCard: "10px", font: humanist,
      titleFont: 'Charter, "Iowan Old Style", "Noto Serif SC", "Songti SC", Georgia, serif',
      shadow: "0 14px 44px #60432214", shadowSmall: "0 2px 8px #6043220C", canvasStep: "24px",
    }),
    theme("midnight", "Midnight · 深海", "深蓝工作区与冰蓝焦点，适合夜间探索。", true, {
      bg: "#101827", panel: "#172235", soft: "#213047", line: "#354760",
      text: "#EAF0FA", muted: "#ADBCD1", accent: "#9FC5FF", active: "#263E5E",
      node: "#1B293E", edge: "#6D819D", accentText: "#13233B", grid: "#2E4059",
      focus: "#B8D5FF", tooltip: "#EAF0FA", tooltipText: "#172235", overlay: "#040B16A6",
    }, {
      radius: "8px", radiusSmall: "5px", radiusCard: "11px", font: sans, titleFont: sans,
      shadow: "0 16px 48px #02081559", shadowSmall: "0 2px 9px #0208152E", canvasStep: "20px",
    }),
    theme("graphite", "Graphite · 石墨", "中性深灰与精炼边界，让结构本身成为主角。", true, {
      bg: "#18191B", panel: "#222427", soft: "#2D3034", line: "#464B52",
      text: "#F1F2F4", muted: "#B8BEC8", accent: "#C5D2E5", active: "#363E4A",
      node: "#272A2E", edge: "#858E9C", accentText: "#242B35", grid: "#3D4249",
      focus: "#D2DFF4", tooltip: "#F1F2F4", tooltipText: "#222427", overlay: "#090A0BB3",
    }, {
      radius: "5px", radiusSmall: "3px", radiusCard: "7px", font: compact, titleFont: compact,
      shadow: "0 12px 36px #0000004D", shadowSmall: "0 2px 6px #00000026", canvasStep: "18px",
    }),
    theme("aurora", "Aurora · 极光", "墨紫底色与柔和薰衣草光点，层次鲜明。", true, {
      bg: "#1A1528", panel: "#251E37", soft: "#332A49", line: "#4F4268",
      text: "#F3EEFC", muted: "#C1B4D8", accent: "#D2B7FF", active: "#403055",
      node: "#2B2340", edge: "#9683B1", accentText: "#2A1844", grid: "#413354",
      focus: "#E0CDFF", tooltip: "#F3EEFC", tooltipText: "#251E37", overlay: "#0C061AB3",
    }, {
      radius: "11px", radiusSmall: "7px", radiusCard: "16px", font: humanist, titleFont: humanist,
      shadow: "0 16px 48px #08021366", shadowSmall: "0 2px 9px #08021333", canvasStep: "22px",
    }),
  ]);
  const byId = new Map(catalog.map((value) => [value.id, value]));
  function resolve(id) {
    return byId.get(id) || catalog[0];
  }
  const cssName = (key) => "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());

  /** DOM use is optional, so the same frozen catalog works in exports and tests. */
  function apply(id) {
    const selected = resolve(id), document = root.document;
    if (!document?.documentElement) return selected;
    document.documentElement.dataset.theme = selected.id;
    for (const element of [document.documentElement, document.body].filter(Boolean)) {
      element.style.colorScheme = selected.dark ? "dark" : "light";
      for (const [key, value] of Object.entries({ ...selected.colors, ...selected.metrics }))
        element.style.setProperty(cssName(key), value);
    }
    document.body?.classList.toggle("dark", selected.dark);
    return selected;
  }

  root.SkylenseThemes = Object.freeze({ catalog, resolve, apply });
})(typeof window !== "undefined" ? window : globalThis);
