import { createElement } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export default function MarkdownView({
  markdown,
  className = "",
  headingPrefix
}: {
  markdown: string;
  className?: string;
  headingPrefix?: string;
}) {
  let headingIndex = 0;
  const heading = (tag: HeadingTag) => {
    return ({ node: _node, ...props }: ComponentPropsWithoutRef<HeadingTag> & { node?: unknown }) =>
      createElement(tag, {
        ...props,
        id: headingPrefix ? `${headingPrefix}-${headingIndex++}` : props.id
      });
  };
  const components: Components = {
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
    input: ({ node: _node, ...props }) => <input {...props} disabled />,
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6")
  };

  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
