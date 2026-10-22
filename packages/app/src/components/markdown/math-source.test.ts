import { describe, expect, it } from "vitest";
import { normalizeMarkdownMath } from "./math-source";

describe("normalizeMarkdownMath", () => {
  it("normalizes inline and multiline display formulas without changing surrounding Markdown", () => {
    expect(normalizeMarkdownMath("**结果** \\(x^2\\)\n\n\\[\nx + y\n\n= z\n\\]")).toBe(
      "**结果** $x^2$\n\n$$x + y\n\n= z$$",
    );
  });

  it("preserves code, link destinations, escapes and unfinished formulas", () => {
    const source =
      "`\\(literal\\)`\n\n```js\n\\[code\\]\n```\n[文档](https://example.org/\\(path\\))\n\\\\(escaped\\) \\(unfinished";
    expect(normalizeMarkdownMath(source)).toBe(source);
  });

  it("does not change dollar formulas or prices", () => {
    const source = "$x^2$ and $$y=2$$; prices $20 and $30";
    expect(normalizeMarkdownMath(source)).toBe(source);
  });
});
