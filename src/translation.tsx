import DOMPurify from "dompurify";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "./api";
import type { DocumentTranslation, KnowledgeData, KnowledgeDocument, ReaderDocumentPayload } from "./types";
import MarkdownView from "./components/MarkdownView";

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption,.pdf-text";

export function safeDocument(html: string): Document {
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "form"],
    FORBID_ATTR: ["srcset"]
  }), "text/html");
  // Scope embedded document styles to its own elements instead of the app UI.
  const inline = new Map([...parsed.querySelectorAll<HTMLElement>("[style]")].map((element) => [element, element.style.cssText]));
  for (const style of parsed.querySelectorAll("style")) {
    if (typeof CSSStyleSheet !== "undefined" && typeof CSSStyleSheet.prototype.replaceSync === "function") {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent || "");
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        try {
          for (const element of parsed.querySelectorAll<HTMLElement>(rule.selectorText)) element.style.cssText += rule.style.cssText;
        } catch { /* Unsupported document selectors do not block translation. */ }
      }
    }
    style.remove();
  }
  for (const [element, css] of inline) element.style.cssText += css;
  if (parsed.body.style.cssText || parsed.documentElement.style.cssText) {
    const wrapper = parsed.createElement("div");
    wrapper.style.cssText = parsed.documentElement.style.cssText + ";" + parsed.body.style.cssText;
    wrapper.append(...parsed.body.childNodes);
    parsed.body.append(wrapper);
  }
  return parsed;
}

/** Translate text nodes only; images, URLs, inline markup, code and formulas stay intact. */
export async function translateHtml(html: string, progress: (detail: string) => void, cancelled: () => boolean) {
  const original = safeDocument(html);
  const candidates = [...original.body.querySelectorAll<HTMLElement>(BLOCKS)];
  let index = 0;
  for (const element of candidates) {
    if (!element.querySelector(BLOCKS)) element.dataset.syncId = `block-${index++}`;
  }
  for (const element of original.body.children) {
    if (!element.querySelector("[data-sync-id]") && !element.hasAttribute("data-sync-id")) element.setAttribute("data-sync-id", `block-${index++}`);
  }
  const translated = safeDocument(original.body.innerHTML);
  const walker = translated.createTreeWalker(translated.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let next = walker.nextNode();
  while (next) {
    const text = next as Text;
    if (/[a-zA-Z\u3400-\u9fff]/.test(text.data) && !text.parentElement?.closest("code,pre,math,.katex,svg")) nodes.push(text);
    next = walker.nextNode();
  }
  // Split long paragraphs as well: no prefix-only translation or model context truncation.
  const segments = nodes.flatMap((node) => {
    const parts: Array<{ node: Text; text: string }> = [];
    let rest = node.data;
    while (rest.length) {
      let end = Math.min(3000, rest.length);
      if (end < rest.length && /[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
      parts.push({ node, text: rest.slice(0, end) });
      rest = rest.slice(end);
    }
    return parts;
  });
  if (!segments.length) throw new Error("没有可翻译正文；扫描件请先完成 OCR，DOC 文件请转换为 DOCX 或 PDF。");
  const results = new Map<Text, string[]>();
  for (let offset = 0; offset < segments.length;) {
    if (cancelled()) throw new Error("翻译已取消，原文已保留");
    const batch: typeof segments = [];
    let length = 0;
    while (offset + batch.length < segments.length && batch.length < 80) {
      const part = segments[offset + batch.length];
      if (batch.length && length + part.text.length > 6000) break;
      batch.push(part); length += part.text.length;
    }
    progress(`正在翻译 ${offset + 1}–${offset + batch.length} / ${segments.length} 个文本片段…`);
    const output = await api.translateSegments(batch.map((part) => part.text));
    if (cancelled()) throw new Error("翻译已取消，原文已保留");
    if (output.length !== batch.length || output.some((text) => !text.trim())) throw new Error("翻译内容不完整，原文已保留，请重试");
    batch.forEach((part, i) => results.set(part.node, [...(results.get(part.node) || []), output[i]]));
    offset += batch.length;
  }
  for (const [node, parts] of results) node.data = parts.join("");
  fitPdfText(translated);
  return { originalHtml: original.body.innerHTML, translatedHtml: translated.body.innerHTML };
}

function fitPdfText(doc: Document) {
  if (!doc.querySelector(".pdf-text")) return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  for (const element of doc.querySelectorAll<HTMLElement>(".pdf-text")) {
    const width = Number(element.dataset.width), height = Number(element.dataset.height);
    const pageWidth = Number(element.dataset.pageWidth);
    let size = Number(element.dataset.fontSize);
    if (!width || !height || !pageWidth || !size) continue;
    while (size > 4) {
      context.font = `${size}px sans-serif`;
      let lines = 1, used = 0;
      for (const character of element.textContent || "") {
        const advance = context.measureText(character).width;
        if (used + advance > width || character === "\n") { lines++; used = 0; }
        used += advance;
      }
      if (lines * size * 1.2 <= height * 1.15) break;
      size -= 0.5;
    }
    element.style.fontSize = `${size / pageWidth * 100}cqw`;
    element.style.whiteSpace = "pre-wrap";
  }
}

async function pdfHtml(payload: ReaderDocumentPayload, progress: (detail: string) => void, cancelled: () => boolean) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: Uint8Array.from(atob(payload.content), (c) => c.charCodeAt(0)) });
  const pdf = await task.promise;
  const root = document.createElement("div");
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      if (cancelled()) throw new Error("翻译已取消，原文已保留");
      progress(`正在解析版式 ${number} / ${pdf.numPages} 页…`);
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const ops = await page.getOperatorList();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1.5, 1600 / viewport.width);
      const rendered = page.getViewport({ scale });
      canvas.width = Math.ceil(rendered.width); canvas.height = Math.ceil(rendered.height);
      const native = text.items.some((item) => "str" in item && item.str.trim());
      await page.render({ canvas, viewport: rendered, operationsFilter: native ? (i) => ![
        pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText
      ].includes(ops.fnArray[i]) : undefined }).promise;
      const section = document.createElement("section");
      section.className = "pdf-layout-page";
      section.style.cssText = `position:relative;container-type:inline-size;width:${viewport.width}px;max-width:100%;margin:16px auto`;
      const image = document.createElement("img");
      image.src = canvas.toDataURL("image/png"); image.alt = `第 ${number} 页图形`;
      image.style.cssText = "display:block;width:100%"; section.append(image);
      canvas.width = 0; canvas.height = 0;
      const paragraphs: Array<{ text: string; x: number; y: number; width: number; height: number; size: number }> = [];
      for (const item of text.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(transform[2], transform[3]) || item.height;
        const x = transform[4], y = transform[5] - size;
        const previous = paragraphs.at(-1);
        // Join text runs on the same line and consecutive lines in the same column.
        const sameLine = previous && Math.abs(previous.y + previous.height - size - y) < size * 0.35 && x >= previous.x && x - (previous.x + previous.width) < size * 2;
        const nextLine = previous && Math.abs(previous.x - x) < size && y >= previous.y + previous.height - size * 0.2 && y - (previous.y + previous.height) < size * 0.65;
        if (previous && (sameLine || nextLine) && Math.abs(previous.size - size) < size * 0.2) {
          previous.text += `${sameLine ? " " : "\n"}${item.str}`;
          previous.width = Math.max(previous.width, x + item.width - previous.x);
          previous.height = Math.max(previous.height, y + size * 1.2 - previous.y);
        } else paragraphs.push({ text: item.str, x, y, width: item.width, height: size * 1.2, size });
      }
      for (const paragraph of paragraphs) {
        const element = document.createElement("div");
        element.className = "pdf-text";
        element.style.cssText = `position:absolute;left:${paragraph.x / viewport.width * 100}%;top:${paragraph.y / viewport.height * 100}%;width:${paragraph.width / viewport.width * 100}%;font-size:${paragraph.size / viewport.width * 100}cqw;line-height:1.2;white-space:pre;overflow-wrap:anywhere`;
        element.dataset.width = String(paragraph.width); element.dataset.height = String(paragraph.height);
        element.dataset.fontSize = String(paragraph.size); element.dataset.pageWidth = String(viewport.width);
        element.textContent = paragraph.text; section.append(element);
      }
      if (!native) {
        // Scanned pages have no editable text positions; keep the scan and reflow OCR below it.
        const extracted = payload.pages.find((p) => p.number === number)?.text;
        const hasRaster = ops.fnArray.some((op) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op));
        if (!extracted?.trim() && hasRaster) throw new Error(`第 ${number} 页没有 OCR 文字，请先完成 OCR 后重试`);
        for (const block of (extracted || "").split(/\n\s*\n/).filter((text) => text.trim())) { const p = document.createElement("p"); p.textContent = block; section.append(p); }
      }
      root.append(section);
      page.cleanup();
    }
    return root.innerHTML;
  } finally { await task.destroy(); }
}

export async function translateDocument(source: KnowledgeDocument, progress: (detail: string) => void, cancelled = () => false): Promise<KnowledgeData | null> {
  if (await api.loadTranslation(source.id)) return null;
  if (source.extension === ".doc") throw new Error("DOC 原件已保留；请先转换为 DOCX 或 PDF 后翻译。");
  const payload = await api.documentPayload(source.id);
  let html: string;
  if (payload.kind === "pdf") html = await pdfHtml(payload, progress, cancelled);
  else if (payload.kind === "html") html = payload.content;
  else if (payload.kind === "markdown") html = renderToStaticMarkup(<MarkdownView markdown={payload.content} />);
  else {
    const root = document.createElement("div");
    for (const block of payload.content.split(/\n\s*\n/)) { const p = document.createElement("p"); p.style.whiteSpace = "pre-wrap"; p.textContent = block; root.append(p); }
    html = root.innerHTML;
  }
  const result = await translateHtml(html, progress, cancelled);
  if (cancelled()) throw new Error("翻译已取消，原文已保留");
  progress("正在保存独立中文文档…");
  return api.saveTranslation({ sourceId: source.id, sourceSha256: source.sha256, ...result });
}

export function interleaveTranslation(value: DocumentTranslation) {
  const doc = safeDocument(value.originalHtml);
  const translated = safeDocument(value.translatedHtml);
  const originals = [...doc.querySelectorAll<HTMLElement>("[data-sync-id]")];
  for (const original of originals) {
    const counterpart = translated.querySelector<HTMLElement>(`[data-sync-id="${original.dataset.syncId}"]`);
    if (!counterpart || counterpart.textContent === original.textContent) continue;
    const copy = doc.createElement("div");
    copy.className = "translation-paragraph";
    copy.lang = "zh-CN";
    copy.innerHTML = counterpart.innerHTML;
    original.after(copy);
  }
  for (const page of doc.querySelectorAll<HTMLElement>(".pdf-layout-page")) page.style.width = "100%";
  for (const block of doc.querySelectorAll<HTMLElement>(".pdf-text")) block.style.cssText = "position:static;font-size:16px;white-space:pre-wrap;margin:16px 0 4px";
  return doc.body.innerHTML;
}
