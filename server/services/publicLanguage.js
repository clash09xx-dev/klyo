// Translate the shared public HTML, not its layout. No client-side replacement or flash.
const polish = require("../content/publicPolish.json");
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const decode = (value) =>
  value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (_, entity) => {
      if (entity[0] === "#")
        return String.fromCodePoint(
          parseInt(
            entity.slice(entity[1]?.toLowerCase() === "x" ? 2 : 1),
            entity[1]?.toLowerCase() === "x" ? 16 : 10,
          ),
        );
      return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[
        entity.toLowerCase()
      ];
    },
  );
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function localize(source, pages, onMissing = () => {}) {
  let inBody = false,
    skip = false;
  function text(value) {
    const key = normalize(decode(value));
    if (!key || !/[a-z]/i.test(key)) return value;
    if (!Object.hasOwn(polish, key)) {
      onMissing(key);
      return value;
    }
    return (
      (value.match(/^\s*/)?.[0] || "") +
      escape(polish[key]) +
      (value.match(/\s*$/)?.[0] || "")
    );
  }
  return source.replace(
    /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g,
    (token) => {
      if (token.startsWith("<!--")) return token;
      if (token.startsWith("<")) {
        if (/^<body\b/i.test(token)) inBody = true;
        if (/^<\/(?:script|style)\b/i.test(token)) skip = false;
        else if (/^<(?:script|style)\b/i.test(token)) skip = true;
        if (!inBody || skip) return token;
        return token.replace(
          /\b(aria-label|alt|title|placeholder|href)=("[^"]*"|'[^']*')/gi,
          (all, name, quoted) => {
            const value = quoted.slice(1, -1);
            if (name.toLowerCase() === "href") {
              const base = value.split(/[?#]/, 1)[0],
                page = pages.find((p) => p.en === base);
              return page
                ? `${name}="${page.pl}${value.slice(base.length)}"`
                : all;
            }
            return `${name}="${text(value)}"`;
          },
        );
      }
      return inBody && !skip ? text(token) : token;
    },
  );
}
const runtimeKeys = [
  "Menu: left ⇄",
  "Menu: right ⇄",
  "Custom accent",
  "Graphite",
  "Day",
  "Ocean",
  "Midnight",
  "Forest",
  "Contrast",
  "Left menu",
  "Right menu",
  "Compact",
  "Comfortable",
  "Try this theme ↗",
  "Motion",
  "Paused",
  "Pause animations",
  "Play animations",
  "A familiar sidebar. Your everyday tools, together.",
  "A section rail with a focused list of tools beside it.",
  "A quiet page list and a document-style work surface.",
  "Your work sections at the top. More room for the work.",
  "Preview full. Create your fields inside the workspace.",
  "Enter a value",
  "Field added to the preview. Try entering a value.",
];
module.exports = {
  localize,
  polish,
  runtime: Object.fromEntries(runtimeKeys.map((key) => [key, polish[key]])),
};
