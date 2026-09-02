import MarkdownIt from "markdown-it";
import { findUnescapedDelimiter, markdownMath } from "./markdown-math";

// Only block maps are needed here; inline parsing belongs to each rendered block.
const markdownBlockParser = new MarkdownIt().use(markdownMath);
markdownBlockParser.core.ruler.disable("inline");

// The renderer decides what counts as a definition, so ask the same parser: a block
// that produces no tokens but registers references is nothing but definitions.
function isLinkReferenceDefinitionBlock(block: string): boolean {
  const env: { references?: Record<string, unknown> } = {};
  const tokens = markdownBlockParser.parse(block, env);
  return tokens.length === 0 && Object.keys(env.references ?? {}).length > 0;
}

/**
 * Definitions render nothing and resolve nothing on their own, so a block made only of
 * them would paint an empty row and break every reference that pointed at it. Fold it
 * into the block it belongs to: the one above, or the one below when it leads.
 */
function foldLinkReferenceDefinitions(blocks: string[]): string[] {
  const folded: string[] = [];
  let leading: string[] = [];
  for (const block of blocks) {
    if (isLinkReferenceDefinitionBlock(block)) {
      if (folded.length > 0) folded[folded.length - 1] += `\n\n${block}`;
      else leading.push(block);
      continue;
    }
    folded.push([...leading, block].join("\n\n"));
    leading = [];
  }
  if (leading.length > 0) folded.push(leading.join("\n\n"));
  return folded;
}

interface DisplayMathDelimiter {
  closing: "$$" | "\\]";
  closesOnOpeningLine: boolean;
}

function getFenceDelimiter(line: string) {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[2] ?? null;
}

function stripMarkdownContainerPrefix(line: string): string {
  let remainder = line;
  let foundContainer = false;

  while (true) {
    const blockquote = /^ {0,3}>[ \t]?/.exec(remainder);
    if (blockquote) {
      remainder = remainder.slice(blockquote[0].length);
      foundContainer = true;
      continue;
    }

    const listItem = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(remainder);
    if (listItem) {
      remainder = remainder.slice(listItem[0].length);
      foundContainer = true;
      continue;
    }

    return foundContainer ? remainder : line;
  }
}

function getDisplayMathDelimiter(line: string): DisplayMathDelimiter | null {
  const content = stripMarkdownContainerPrefix(line);
  const match = /^ {0,3}(\$\$|\\\[)/.exec(content);
  if (!match) {
    return null;
  }

  const opening = match[1];
  const closing = opening === "$$" ? "$$" : "\\]";
  const remainder = content.slice(match[0].length);
  return {
    closing,
    closesOnOpeningLine: findUnescapedDelimiter(remainder, closing) !== -1,
  };
}

function getDisplayMathProtectedBlankLines(lines: string[]): Set<number> {
  const blankLines = new Set<number>();
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;
  let activeDisplayMathClosing: DisplayMathDelimiter["closing"] | null = null;

  for (const [index, line] of lines.entries()) {
    if (activeDisplayMathClosing) {
      if (line.trim().length === 0) {
        blankLines.add(index);
      }
      if (findUnescapedDelimiter(line, activeDisplayMathClosing) !== -1) {
        activeDisplayMathClosing = null;
      }
      continue;
    }

    const fenceDelimiter = getFenceDelimiter(line);
    if (activeFenceCharacter) {
      if (
        fenceDelimiter?.[0] === activeFenceCharacter &&
        fenceDelimiter.length >= activeFenceLength
      ) {
        activeFenceCharacter = null;
        activeFenceLength = 0;
      }
      continue;
    }

    if (fenceDelimiter) {
      activeFenceCharacter = fenceDelimiter[0] as "`" | "~";
      activeFenceLength = fenceDelimiter.length;
      continue;
    }

    const displayMathDelimiter = getDisplayMathDelimiter(line);
    if (displayMathDelimiter && !displayMathDelimiter.closesOnOpeningLine) {
      activeDisplayMathClosing = displayMathDelimiter.closing;
    }
  }

  return blankLines;
}

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let sawBlockSeparator = false;
  const lines = text.split("\n");
  const structuralBlankLines = getStructuralBlankLines(text, lines);
  for (const index of getDisplayMathProtectedBlankLines(lines)) {
    structuralBlankLines.add(index);
  }

  for (const [index, line] of lines.entries()) {
    const isBlankLine = line.trim().length === 0;

    if (isBlankLine && structuralBlankLines.has(index)) {
      currentLines.push(line);
      continue;
    }

    if (isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return foldLinkReferenceDefinitions(blocks.filter((block) => block.length > 0));
}

function getStructuralBlankLines(text: string, lines: string[]): Set<number> {
  const blankLines = new Set<number>();
  for (const token of markdownBlockParser.parse(text, {})) {
    if (token.level !== 0 || !token.map) {
      continue;
    }
    const [start, end] = token.map;
    for (let index = start; index < end - 1; index += 1) {
      if (lines[index]?.trim().length === 0) {
        blankLines.add(index);
      }
    }
  }
  return blankLines;
}
