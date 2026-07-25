import { useEffect, useRef, useState, useMemo } from "react";
import { marked } from "marked";
import katex from "katex";

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MarkdownViewProps {
  markdown: string;
  className?: string;
}

// Custom renderer that handles LaTeX before marked processing
function renderMarkdown(text: string): string {
  // Protect LaTeX blocks from marked processing
  const latexBlocks: string[] = [];
  const latexInlines: string[] = [];

  let processed = text
    // Replace display math $$...$$
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, formula) => {
      latexBlocks.push(formula.trim());
      return `\x00LATEXBLOCK${latexBlocks.length - 1}\x00`;
    })
    // Replace inline math $...$
    .replace(/\$(.+?)\$/g, (_, formula) => {
      latexInlines.push(formula.trim());
      return `\x00LATEXINLINE${latexInlines.length - 1}\x00`;
    })
    // Also handle \[...\] and \(...\)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => {
      latexBlocks.push(formula.trim());
      return `\x00LATEXBLOCK${latexBlocks.length - 1}\x00`;
    })
    .replace(/\\\((.+?)\\\)/g, (_, formula) => {
      latexInlines.push(formula.trim());
      return `\x00LATEXINLINE${latexInlines.length - 1}\x00`;
    });

  // Parse markdown to HTML
  let html = marked.parse(processed) as string;
  if (typeof html !== "string") html = String(html);

  // Sanitize: remove scripts, event handlers, etc.
  html = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");

  // Render LaTeX blocks
  html = html.replace(/\x00LATEXBLOCK(\d+)\x00/g, (_, i) => {
    const formula = latexBlocks[parseInt(i)];
    if (!formula) return "";
    try {
      return katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return `<pre class="text-red-500">LaTeX error: ${escapeHtml(formula)}</pre>`;
    }
  });

  // Render LaTeX inline
  html = html.replace(/\x00LATEXINLINE(\d+)\x00/g, (_, i) => {
    const formula = latexInlines[parseInt(i)];
    if (!formula) return "";
    try {
      return katex.renderToString(formula, {
        displayMode: false,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return `<span class="text-red-500">LaTeX error</span>`;
    }
  });

  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function MarkdownView({ markdown, className = "" }: MarkdownViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    if (contentRef.current) {
      const observer = new ResizeObserver(() => {
        if (contentRef.current) {
          setHeight(contentRef.current.scrollHeight);
        }
      });
      observer.observe(contentRef.current);
      // Initial height
      setHeight(contentRef.current.scrollHeight);
      return () => observer.disconnect();
    }
  }, [html]);

  return (
    <div
      ref={contentRef}
      className={`markdown-body ${className}`}
      style={{ minHeight: Math.max(24, height) }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Inline markdown (no block-level wrapper)
export function MarkdownInline({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
