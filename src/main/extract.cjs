'use strict';

const fs = require('node:fs');

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(p|div|section|article|h[1-6]|li|tr|blockquote|br)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeHtml(html) {
  return html
    .replace(/<(script|style|noscript|iframe|object|embed|form|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|noscript|iframe|object|embed|form|base)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

async function extractDocument(filePath, extension) {
  if (extension === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        number: pageNumber,
        text: content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim()
      });
    }
    return { text: pages.map((page) => page.text).join('\n\n'), pages };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (extension === '.html' || extension === '.htm') {
    return { text: htmlToText(raw), html: safeHtml(raw), pages: [] };
  }
  return { text: raw, pages: [] };
}

module.exports = { extractDocument, htmlToText, safeHtml };
