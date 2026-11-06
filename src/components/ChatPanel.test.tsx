import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChatPanel from "./ChatPanel";
import { api } from "../api";
import type { AppSettings, KnowledgeData, KnowledgeDocument } from "../types";
vi.mock("../api", () => ({ api: { runAgent: vi.fn(), saveConversation: vi.fn(), updateSettings: vi.fn() } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const current: KnowledgeDocument = { id: "current", name: "Current.pdf", extension: ".pdf", size: 1, authors: [], sha256: "hash", importedAt: "", status: "ready" };
const other = { ...current, id: "other", name: "Other.pdf" };
const data: KnowledgeData = { version: 8, documents: [current, other], topics: [], documentTopics: [], bookmarks: [], annotations: [], conversations: [], topicSummaries: [], summaryNotes: [] };
const settings: AppSettings = { provider: "custom", baseURL: "", model: "", chatBackend: "codex", chatPlacement: "right", libraryVisible: true, apiContextMode: "relevantFragments", visionEnabled: false, localOcrEnabled: false };
const props = { data, settings, agentAvailability: { codex: "/bin/codex", claudeCode: null }, onQuote: vi.fn(), onData: vi.fn(), onSettings: vi.fn() };

it("defaults to the displayed document, follows tab changes, and allows deselection before agent launch", async () => {
  const view = render(<ChatPanel {...props} currentDocument={current} />);
  expect(screen.getByRole("button", { name: "Current.pdf" })).toBeVisible();
  view.rerender(<ChatPanel {...props} currentDocument={other} />);
  expect(screen.queryByRole("button", { name: "Current.pdf" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Other.pdf" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "问答范围" }));
  expect(screen.getByRole("checkbox", { name: "Other.pdf" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Other.pdf" }));
  expect(screen.getByRole("checkbox", { name: "Other.pdf" })).not.toBeChecked();
  vi.mocked(api.runAgent).mockResolvedValue({ answer: "answer", generatedFiles: [], pendingImports: [], traceEvents: [] });
  vi.mocked(api.saveConversation).mockResolvedValue(data);
  fireEvent.change(screen.getByPlaceholderText("输入问题…"), { target: { value: "hello" } });
  fireEvent.keyDown(screen.getByPlaceholderText("输入问题…"), { key: "Enter" });
  await waitFor(() => expect(api.runAgent).toHaveBeenCalled());
  expect(vi.mocked(api.runAgent).mock.calls[0][0].documentIds).toEqual([]);
});

it("passes the default current document to the agent without opening the scope picker", async () => {
  vi.mocked(api.runAgent).mockResolvedValue({ answer: "answer", generatedFiles: [], pendingImports: [], traceEvents: [] });
  vi.mocked(api.saveConversation).mockResolvedValue(data);
  render(<ChatPanel {...props} currentDocument={current} />);
  fireEvent.change(screen.getByPlaceholderText("输入问题…"), { target: { value: "explain" } });
  fireEvent.keyDown(screen.getByPlaceholderText("输入问题…"), { key: "Enter" });
  await waitFor(() => expect(api.runAgent).toHaveBeenCalled());
  expect(vi.mocked(api.runAgent).mock.calls[0][0].documentIds).toEqual([current.id]);
});

it("includes the displayed document when agent mode is activated from settings", () => {
  const view = render(<ChatPanel {...props} settings={{ ...settings, chatBackend: "direct" }} currentDocument={current} />);
  expect(screen.queryByRole("button", { name: "Current.pdf" })).not.toBeInTheDocument();
  view.rerender(<ChatPanel {...props} currentDocument={current} />);
  expect(screen.getByRole("button", { name: "Current.pdf" })).toBeVisible();
});
