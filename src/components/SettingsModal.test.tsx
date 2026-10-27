import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsModal from "./SettingsModal";
import { api } from "../api";
import type { BootstrapState, OcrStatus } from "../types";

vi.mock("../api", () => ({ api: { ocrStatus: vi.fn(), setupOcr: vi.fn(), cancelOcrSetup: vi.fn(), updateSettings: vi.fn() } }));
const missing: OcrStatus = { ready: false, installing: false, detail: "", directory: "/test/ocr" };
const ready: OcrStatus = { ...missing, ready: true, detail: "本地 CPU OCR 已就绪" };
const state: BootstrapState = {
  rootPath: "/test/source", warnings: [], agentAvailability: { claudeCode: null, codex: null },
  data: { version: 8, documents: [], topics: [], documentTopics: [], bookmarks: [], annotations: [], conversations: [], topicSummaries: [], summaryNotes: [] },
  settings: { provider: "custom", baseURL: "", model: "", chatBackend: "direct", chatPlacement: "right", libraryVisible: true, apiContextMode: "relevantFragments", visionEnabled: false, localOcrEnabled: true }
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.ocrStatus).mockResolvedValue(missing);
});
afterEach(cleanup);

it("downloads on demand with the selected source and shows readiness", async () => {
  vi.mocked(api.setupOcr).mockResolvedValue(ready);
  render(<SettingsModal state={state} onState={vi.fn()} onClose={vi.fn()} />);
  expect(await screen.findByText("尚未下载；普通文字 PDF 仍可直接导入。")).toBeVisible();
  expect(api.setupOcr).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: /自动使用本地 CPU OCR/ })).toBeChecked();
  fireEvent.change(screen.getByRole("combobox", { name: "模型下载源" }), { target: { value: "modelscope" } });
  fireEvent.click(screen.getByRole("button", { name: "下载 OCR 模型与运行环境" }));
  expect(await screen.findByRole("button", { name: "CPU OCR 已就绪" })).toBeDisabled();
  expect(api.setupOcr).toHaveBeenCalledWith("modelscope");
});

it("supports cancelling setup and retrying without disabling normal imports", async () => {
  let cancel!: (reason: string) => void;
  vi.mocked(api.setupOcr).mockImplementationOnce(() => new Promise((_, reject) => { cancel = reject; })).mockResolvedValueOnce(ready);
  vi.mocked(api.cancelOcrSetup).mockImplementation(async () => { cancel("已取消下载"); });
  render(<SettingsModal state={state} onState={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText("尚未下载；普通文字 PDF 仍可直接导入。");
  fireEvent.click(screen.getByRole("button", { name: "下载 OCR 模型与运行环境" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消下载" }));
  expect(await screen.findByText("已取消下载")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "下载 OCR 模型与运行环境" }));
  expect(await screen.findByRole("button", { name: "CPU OCR 已就绪" })).toBeDisabled();
  expect(api.setupOcr).toHaveBeenCalledTimes(2);
});
