import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { normalizeAssistantMarkdown } from "../lib/assistant-markdown";

const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer noopener">{children}</a>
  ),
};

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalizeAssistantMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
