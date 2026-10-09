/**
 * Normalizes compact Markdown occasionally returned by the model into actual
 * list blocks so it remains readable even when the model omits line breaks.
 */
export function normalizeAssistantMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+(?=\d{1,2}[.)]\s+(?:\*\*|[A-Z`]))/g, "\n\n")
    .replace(/(\*\*[^*\n]+\*\*:?)\s*[-*•]\s+/g, "$1\n- ")
    .replace(/(?<=[.;:])[ \t]+[-*•][ \t]+(?=[A-Za-z`])/g, "\n- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  let insideOrderedListItem = false;
  return normalized.split("\n").map((line) => {
    if (/^\s*\d{1,2}[.)]\s+/.test(line)) {
      insideOrderedListItem = true;
      return line;
    }
    if (insideOrderedListItem && /^\s*[-*+•]\s+/.test(line)) {
      return `   ${line.trimStart()}`;
    }
    if (line.trim() && !/^\s{2,}/.test(line)) insideOrderedListItem = false;
    return line;
  }).join("\n");
}
