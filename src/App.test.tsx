import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import type { BootstrapState, KnowledgeData } from "./types";

vi.mock("./api", () => ({ api: { bootstrap: vi.fn(), reload: vi.fn(), recommendations: vi.fn() } }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} })
}));
vi.mock("./components/Reader", () => ({ default: () => null }));
vi.mock("./components/ChatPanel", () => ({ default: () => null }));
vi.mock("./components/SettingsModal", () => ({ default: () => null }));

const empty: KnowledgeData = {
  version: 8, documents: [], topics: [], documentTopics: [], bookmarks: [],
  annotations: [], conversations: [], topicSummaries: [], summaryNotes: []
};
const initial: BootstrapState = {
  rootPath: "/test/source", data: empty, warnings: [],
  agentAvailability: { claudeCode: null, codex: null },
  settings: {
    provider: "custom", baseURL: "", model: "", chatBackend: "direct", chatPlacement: "right",
    libraryVisible: true, apiContextMode: "relevantFragments", visionEnabled: false, localOcrEnabled: true
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "localStorage", {
    configurable: true, value: { getItem: vi.fn(() => null), setItem: vi.fn() }
  });
  vi.mocked(api.bootstrap).mockResolvedValue(initial);
  vi.mocked(api.recommendations).mockResolvedValue([]);
});
afterEach(cleanup);

it("shows successful documents and skipped-file details, then clears resolved warnings", async () => {
  const data: KnowledgeData = {
    ...empty, documents: [{
      id: "good", name: "good.pdf", authors: [], extension: ".pdf", size: 1,
      sha256: "test", importedAt: "2026-10-27T00:00:00Z", status: "ready"
    }]
  };
  vi.mocked(api.reload)
    .mockResolvedValueOnce({ data, warnings: ["已跳过：bad.pdf（文本解析器内部异常）"] })
    .mockResolvedValueOnce({ data, warnings: [] });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "刷新目录" }));
  expect(await screen.findByText("目录已刷新，新增 1 份资料")).toBeVisible();
  expect(screen.getByText("1 份资料")).toBeVisible();
  const summary = screen.getByText("已跳过 1 项失败处理，其余资料已刷新");
  fireEvent.click(summary);
  expect(screen.getByText("已跳过：bad.pdf（文本解析器内部异常）")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新目录" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新目录" }));
  expect(await screen.findByText("目录已刷新，没有发现新资料")).toBeVisible();
  expect(screen.queryByText(/已跳过 1 项失败处理/)).not.toBeInTheDocument();
});

it("still reports a library-level failure and allows another refresh", async () => {
  vi.mocked(api.reload).mockRejectedValue("数据库无法读取");
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "刷新目录" }));
  expect(await screen.findByText("刷新失败：数据库无法读取")).toBeVisible();
  expect(screen.getByRole("button", { name: "刷新目录" })).toBeEnabled();
  expect(screen.getByText("0 份资料")).toBeVisible();
});
