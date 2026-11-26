import type { ReactNode } from "react";

/**
 * A bounded Markdown renderer for assistant replies: paragraphs, bullet and numbered lists,
 * headings shown as bold lines, **bold**, *italic* and `code`. It builds React text nodes only:
 * no raw HTML, no images and no links, so a reply cannot load or send anything (TDD 03).
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: Static rendered text.
      <li key={i}>{inline(item)}</li>
    ));
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    // A bare marker is a list item whose words have not streamed in yet.
    const bullet = /^\s*[-*](?:\s+(.*))?$/.exec(line);
    const numbered = /^\s*\d+[.)](?:\s+(.*))?$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <p key={blocks.length}>
          <strong>{inline(heading[1])}</strong>
        </p>,
      );
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return <div className="md">{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function inline(text: string): ReactNode[] {
  return text
    .split(TOKEN)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**"))
        // biome-ignore lint/suspicious/noArrayIndexKey: Static rendered text.
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        // biome-ignore lint/suspicious/noArrayIndexKey: Static rendered text.
        return <code key={i}>{part.slice(1, -1)}</code>;
      if (
        part.length > 2 &&
        ((part.startsWith("*") && part.endsWith("*")) ||
          (part.startsWith("_") && part.endsWith("_")))
      )
        // biome-ignore lint/suspicious/noArrayIndexKey: Static rendered text.
        return <em key={i}>{part.slice(1, -1)}</em>;
      return part;
    });
}
