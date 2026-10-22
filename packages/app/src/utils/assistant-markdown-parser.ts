import type MarkdownIt from "markdown-it";
import { markdownMath } from "@/utils/markdown-math";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  parser.use(markdownMath);
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Rich clipboard HTML preserves workspace file links.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
