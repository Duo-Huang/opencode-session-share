import MarkdownIt from "markdown-it"
import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import go from "highlight.js/lib/languages/go"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import lua from "highlight.js/lib/languages/lua"
import makefile from "highlight.js/lib/languages/makefile"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import sql from "highlight.js/lib/languages/sql"
import swift from "highlight.js/lib/languages/swift"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

for (const [name, language] of [
  ["bash", bash],
  ["c", c],
  ["cpp", cpp],
  ["csharp", csharp],
  ["css", css],
  ["diff", diff],
  ["dockerfile", dockerfile],
  ["go", go],
  ["ini", ini],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["kotlin", kotlin],
  ["lua", lua],
  ["makefile", makefile],
  ["markdown", markdown],
  ["php", php],
  ["python", python],
  ["ruby", ruby],
  ["rust", rust],
  ["sql", sql],
  ["swift", swift],
  ["typescript", typescript],
  ["xml", xml],
  ["yaml", yaml],
] as const) {
  hljs.registerLanguage(name, language)
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const languageAliases: Record<string, string> = {
  console: "bash",
  jsx: "javascript",
  shell: "bash",
  sh: "bash",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash",
}

export function highlightCode(code: string, language?: string) {
  const normalized = language ? (languageAliases[language.toLowerCase()] ?? language) : ""
  const lang = normalized && hljs.getLanguage(normalized) ? normalized : ""
  if (!lang) return escapeHtml(code)
  try {
    return hljs.highlight(code, { language: lang }).value
  } catch {
    return escapeHtml(code)
  }
}

const languageByExtension: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  dockerfile: "dockerfile",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  makefile: "makefile",
  md: "markdown",
  mjs: "javascript",
  cjs: "javascript",
  patch: "diff",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
}

export function languageFromFile(file: string) {
  const name = file.split("/").pop() ?? file
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  return languageByExtension[extension] ?? ""
}

function highlight(code: string, language: string) {
  return highlightCode(code, language)
}

md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0] || "text"
  const code = token.content
  const highlighted = highlight(code, language)
  return `<figure class="code-block" data-code-scope><figcaption><span>${escapeHtml(language)}</span><button type="button" class="copy-button" data-copy>copy</button></figcaption><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></figure>`
}

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  token.attrSet("target", "_blank")
  token.attrSet("rel", "noopener noreferrer nofollow")
  return defaultLinkOpen(tokens, index, options, env, self)
}

// Images are rendered as text references: the public page never loads external
// images, which would leak viewer IPs and referrers.
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const alt = token.content || token.attrGet("src") || "image"
  return `<span class="text-[var(--ink-muted)]">[image: ${escapeHtml(alt)}]</span>`
}

export function renderMarkdown(text: string) {
  return DOMPurify.sanitize(md.render(text), {
    ADD_ATTR: ["target", "rel", "data-copy", "data-code-scope"],
  })
}
