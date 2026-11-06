import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { interleaveTranslation, safeDocument, translateDocument, translateHtml } from "./translation";
import { alignedScroll } from "./components/TranslationView";

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), destroy: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  OPS: { showText: 1, showSpacedText: 2, nextLineShowText: 3, nextLineSetSpacingShowText: 4, paintImageXObject: 5, paintInlineImageXObject: 6, paintImageMaskXObject: 7 },
  Util: { transform: (_viewport: number[], transform: number[]) => transform },
  getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: pdf.getPage }), destroy: pdf.destroy })
}));
vi.mock("./api", () => ({ api: { translateSegments: vi.fn(), loadTranslation: vi.fn(), documentPayload: vi.fn(), saveTranslation: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it("translates all long-document segments while preserving inline structure, images, tables and code", async () => {
  vi.mocked(api.translateSegments).mockImplementation(async (texts) => texts.map((s) => `译${s}`));
  const source = `<h1>Title</h1><p>Hello <em>world</em><img src="data:image/png;base64,AA=="></p><table><tr><td>Table text</td></tr></table><pre><code>keep_code()</code></pre><p>${"Long text ".repeat(1200)}</p>`;
  const result = await translateHtml(source, vi.fn(), () => false);
  expect(vi.mocked(api.translateSegments).mock.calls.length).toBeGreaterThan(1);
  const sent = vi.mocked(api.translateSegments).mock.calls.flatMap(([texts]) => texts).join("");
  expect(sent).toContain("Long text ".repeat(1200));
  expect(sent).not.toContain("keep_code");
  const doc = safeDocument(result.translatedHtml);
  expect(doc.querySelector("em")?.textContent).toBe("译world");
  expect(doc.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
  expect(doc.querySelector("td")?.textContent).toBe("译Table text");
  expect(doc.querySelector("code")?.textContent).toBe("keep_code()");
  expect(doc.querySelectorAll("[data-sync-id]").length).toBeGreaterThan(2);
});

it("rejects incomplete batches and stops after cancellation without issuing the next batch", async () => {
  vi.mocked(api.translateSegments).mockResolvedValue([]);
  await expect(translateHtml("<p>One</p><p>Two</p>", vi.fn(), () => false)).rejects.toThrow("不完整");
  let cancelled = false;
  vi.mocked(api.translateSegments).mockImplementation(async (texts) => { cancelled = true; return texts; });
  await expect(translateHtml(`<p>${"long ".repeat(3000)}</p>`, vi.fn(), () => cancelled)).rejects.toThrow("取消");
  expect(api.translateSegments).toHaveBeenCalledTimes(2); // One rejected call above, one cancelled call.
});

it("interleaves corresponding paragraphs once and retains one shared image", () => {
  const html = interleaveTranslation({ sourceId: "source", sourceSha256: "hash",
    originalHtml: '<p data-sync-id="block-0">English <em>term</em></p><img src="data:image/png;base64,AA==">',
    translatedHtml: '<p data-sync-id="block-0">中文<em>术语</em></p><img src="data:image/png;base64,AA==">'
  });
  const doc = safeDocument(html);
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  expect(doc.querySelector("p")?.nextElementSibling?.textContent).toBe("中文术语");
  expect(doc.querySelector(".translation-paragraph em")?.textContent).toBe("术语");
});

it("synchronizes within a corresponding paragraph even when document heights differ", () => {
  const source = document.createElement("div"), target = document.createElement("div");
  for (const host of [source, target]) host.innerHTML = '<p data-sync-id="one"></p><p data-sync-id="two"></p>';
  source.scrollTop = 200; target.scrollTop = 0;
  const rect = (top: number) => ({ top } as DOMRect);
  source.getBoundingClientRect = () => rect(0); target.getBoundingClientRect = () => rect(0);
  source.children[0].getBoundingClientRect = () => rect(-100); source.children[1].getBoundingClientRect = () => rect(100);
  target.children[0].getBoundingClientRect = () => rect(150); target.children[1].getBoundingClientRect = () => rect(550);
  expect(alignedScroll(source, target)).toBe(350);
});

it("retains PDF graphics, translates native text, and keeps blank pages without requiring OCR", async () => {
  const render = vi.fn((_args: { operationsFilter?: (index: number) => boolean }) => ({ promise: Promise.resolve() }));
  const basePage = { getViewport: () => ({ width: 595, height: 842, transform: [1, 0, 0, 1, 0, 0] }), render, cleanup: vi.fn() };
  pdf.getPage.mockResolvedValueOnce({ ...basePage,
    getTextContent: async () => ({ items: [{ str: "Full paragraph", transform: [12, 0, 0, 12, 70, 90], height: 12, width: 120 }] }),
    getOperatorList: async () => ({ fnArray: [1, 5] })
  }).mockResolvedValueOnce({ ...basePage, getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [] }) });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmlndXJl");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText: () => ({ width: 8 }) } as unknown as CanvasRenderingContext2D);
  vi.mocked(api.loadTranslation).mockResolvedValue(null);
  vi.mocked(api.documentPayload).mockResolvedValue({ kind: "pdf", content: btoa("fixture"), extractedText: "Full paragraph", pages: [] });
  vi.mocked(api.translateSegments).mockResolvedValue(["完整段落"]);
  const source = { id: "source", name: "paper.pdf", extension: ".pdf", authors: [], sha256: "hash", size: 1, importedAt: "", status: "ready" };
  await translateDocument(source, vi.fn());
  const saved = vi.mocked(api.saveTranslation).mock.calls[0][0];
  expect(saved.translatedHtml).toContain("完整段落");
  expect(safeDocument(saved.translatedHtml).querySelectorAll(".pdf-layout-page")).toHaveLength(2);
  expect(safeDocument(saved.translatedHtml).querySelectorAll("img")).toHaveLength(2);
  expect(render.mock.calls[0][0].operationsFilter!(0)).toBe(false);
  expect(render.mock.calls[0][0].operationsFilter!(1)).toBe(true);
  expect(pdf.destroy).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("refuses to silently skip a scanned page without OCR text", async () => {
  pdf.getPage.mockResolvedValue({ getViewport: () => ({ width: 595, height: 842 }),
    getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [5] }), render: () => ({ promise: Promise.resolve() }) });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZmlndXJl");
  vi.mocked(api.loadTranslation).mockResolvedValue(null);
  vi.mocked(api.documentPayload).mockResolvedValue({ kind: "pdf", content: btoa("scan"), extractedText: "", pages: [] });
  await expect(translateDocument({ id: "scan", name: "scan.pdf", extension: ".pdf", authors: [], sha256: "hash", size: 1, importedAt: "", status: "ready" }, vi.fn())).rejects.toThrow("第 1 页没有 OCR");
  expect(api.saveTranslation).not.toHaveBeenCalled();
  expect(pdf.destroy).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});
