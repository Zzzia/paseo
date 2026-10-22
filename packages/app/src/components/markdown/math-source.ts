import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { findUnescapedDelimiter } from "@/utils/markdown-math";

const DELIMITERS = [
  { opening: "\\(", closing: "\\)", canonical: "$" },
  { opening: "\\[", closing: "\\]", canonical: "$$" },
];

/** 保留既有反斜杠公式语法，代码和链接交给 Markdown 引擎原样处理。 */
export function normalizeMarkdownMath(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;
  const protectedRanges = getProtectedRanges(source);
  const parts: string[] = [];
  let cursor = 0;
  let rangeIndex = 0;
  const closings = new Map<string, number>();
  while (cursor < source.length) {
    const range = protectedRanges[rangeIndex];
    if (range && cursor >= range.start) {
      parts.push(source.slice(cursor, range.end));
      cursor = range.end;
      rangeIndex++;
      continue;
    }
    const delimiter = DELIMITERS.find(({ opening }) => source.startsWith(opening, cursor));
    if (!delimiter || (cursor > 0 && source[cursor - 1] === "\\")) {
      parts.push(source[cursor++]);
      continue;
    }
    const start = cursor + delimiter.opening.length;
    let closing = closings.get(delimiter.closing);
    if (closing === undefined || (closing >= 0 && closing < start)) {
      closing = findUnescapedDelimiter(source, delimiter.closing, start);
      closings.set(delimiter.closing, closing);
    }
    if (closing < 0 || (range && closing >= range.start)) {
      parts.push(source[cursor++]);
      continue;
    }
    const expression = source.slice(start, closing);
    if (!expression.trim() || (delimiter.canonical === "$" && expression.includes("\n"))) {
      parts.push(source[cursor++]);
      continue;
    }
    parts.push(delimiter.canonical, expression.trim(), delimiter.canonical);
    cursor = closing + delimiter.closing.length;
  }
  return parts.join("");
}

function getProtectedRanges(source: string) {
  const protectedRanges: { start: number; end: number }[] = [];
  function protect(node: Nodes) {
    if (["code", "inlineCode", "link", "image"].includes(node.type) && node.position) {
      protectedRanges.push({ start: node.position.start.offset!, end: node.position.end.offset! });
    } else if ("children" in node) node.children.forEach(protect);
  }
  protect(fromMarkdown(source));
  return protectedRanges;
}
