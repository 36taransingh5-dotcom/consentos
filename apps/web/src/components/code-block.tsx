import clsx from "clsx";
import type { ReactNode } from "react";

type Lang = "ts" | "json" | "http" | "bash" | "text";

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "await",
  "async",
  "function",
  "return",
  "if",
  "else",
  "new",
  "true",
  "false",
  "null",
  "throw",
  "try",
  "catch",
]);

/**
 * A deliberately tiny highlighter: strings, numbers, keywords, comments and
 * JSON keys. Enough for short documentation snippets without a dependency.
 */
function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === "text") return [code];
  const out: ReactNode[] = [];
  const pattern =
    /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)/g;
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(pattern)) {
    const [text, comment, jsonKey, str, num, word] = match;
    const index = match.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    last = index + text.length;
    if (comment && (lang === "ts" ? text.startsWith("//") : lang === "bash" && text.startsWith("#"))) {
      out.push(<span key={key++} className="text-[#6b7280]">{text}</span>);
    } else if (jsonKey) {
      out.push(<span key={key++} className="text-[#9ecbff]">{text}</span>);
    } else if (str) {
      out.push(<span key={key++} className="text-[#a5e0b3]">{text}</span>);
    } else if (num) {
      out.push(<span key={key++} className="text-[#f5c07a]">{text}</span>);
    } else if (word && KEYWORDS.has(word) && lang !== "http") {
      out.push(<span key={key++} className="text-[#c4b5fd]">{text}</span>);
    } else if (word && lang === "http" && /^(POST|GET|HTTP|Forbidden|OK)$/.test(word)) {
      out.push(<span key={key++} className="text-[#c4b5fd]">{text}</span>);
    } else {
      out.push(text);
    }
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({
  code,
  lang = "ts",
  title,
  className,
}: {
  code: string;
  lang?: Lang;
  title?: string;
  className?: string;
}) {
  return (
    <figure className={clsx("overflow-hidden rounded-2xl border border-[#23232a] bg-[#0f0f12] text-[#e7e7ea]", className)}>
      {title && (
        <figcaption className="flex items-center gap-2 border-b border-[#23232a] px-4 py-2.5 font-mono text-[11.5px] text-[#8b8b95]">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
            <span className="size-2.5 rounded-full bg-[#2a2a31]" />
          </span>
          <span className="ml-1">{title}</span>
        </figcaption>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] sm:p-5">
        <code>{highlight(code.trim(), lang)}</code>
      </pre>
    </figure>
  );
}
