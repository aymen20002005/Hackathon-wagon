const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set([
  "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "main",
  "nav", "aside", "table", "tr", "td", "th", "dd", "dt", "dl", "blockquote", "pre", "body", "html", "form", "address",
]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "head"]);

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?!\.)|opacity\s*:\s*0(?![.\d])|left\s*:\s*-\d{3,}px|text-indent\s*:\s*-\d{3,}/i;
const isHidden = (attrs) => /(^|\s)hidden(?=[\s=/]|$)/i.test(attrs) || /aria-hidden\s*=\s*["']?true/i.test(attrs) || HIDDEN_STYLE.test(attrs);

const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// Splits a page into text blocks and records which ones a human visitor would never see.
export function htmlToBlocks(html) {
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];
  const stack = [];
  const blocks = [];
  let cur = null;

  const flush = () => {
    const text = cur?.text.replace(/\s+/g, " ").trim();
    if (text) blocks.push({ text, hidden: cur.hidden, tag: cur.tag });
    cur = null;
  };

  for (const tok of tokens) {
    if (tok.startsWith("<!--")) {
      flush();
      const text = tok.slice(4, -3).trim();
      if (text) blocks.push({ text, hidden: true, tag: "comment" });
      continue;
    }
    if (tok.startsWith("<")) {
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/.exec(tok);
      if (!m) continue;
      const [, close, raw, attrs] = m;
      const tag = raw.toLowerCase();
      if (VOID.has(tag)) continue;
      if (close) {
        if (BLOCK.has(tag)) flush();
        const idx = stack.map((s) => s.tag).lastIndexOf(tag);
        if (idx >= 0) stack.length = idx;
        continue;
      }
      if (BLOCK.has(tag)) flush();
      if (!/\/\s*$/.test(attrs)) stack.push({ tag, hidden: isHidden(attrs), skip: SKIP.has(tag) });
      continue;
    }
    if (stack.some((s) => s.skip)) continue;
    const hidden = stack.some((s) => s.hidden);
    if (cur && cur.hidden !== hidden) flush();
    cur ??= { text: "", hidden, tag: stack.at(-1)?.tag ?? "body" };
    cur.text += decode(tok);
  }
  flush();
  return blocks.map((b, i) => ({ id: `b${i + 1}`, ...b }));
}

// Context.dev returns Markdown: no hidden-content signal is available there.
export function markdownToBlocks(md) {
  return md
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, i) => {
      const heading = /^#\s+(.*)/.exec(chunk);
      return { id: `b${i + 1}`, text: (heading ? heading[1] : chunk).replace(/\s+/g, " "), hidden: false, tag: heading ? "h1" : "p" };
    });
}
