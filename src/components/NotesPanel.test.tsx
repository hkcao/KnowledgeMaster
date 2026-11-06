import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import NotesPanel from "./NotesPanel";
import { api } from "../api";
import { knowledgeFixture } from "../test/notesFixture";
vi.mock("../api", () => ({ api: { setNoteLink: vi.fn(), suggestNoteLinks: vi.fn(), updateAnnotation: vi.fn(), saveSummaryNote: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Fixture() {
  const [data, setData] = useState(knowledgeFixture);
  return <NotesPanel data={data} onData={setData} onOpenAnnotation={vi.fn()}/>;
}
it("searches notes and annotation excerpts without opening the original document", () => {
  render(<Fixture/>);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索笔记和注释" }), { target: { value: "Zero-copy" } });
  expect(screen.getAllByRole("button", { pressed: false }).some((e) => e.textContent?.includes("零拷贝路径"))).toBe(true);
  expect(screen.queryByText("缓存设计")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索笔记和注释" }), { target: { value: "not-present" } });
  expect(screen.getByText("没有匹配内容")).toBeVisible();
});
it("highlights the connected chain and allows switching to direct neighbors", () => {
  render(<Fixture/>);
  fireEvent.click(screen.getByText("缓存设计"));
  fireEvent.click(screen.getByRole("button", { name: /知识图谱/ }));
  const dialog = screen.getByRole("dialog", { name: "知识关联" });
  const graph = within(dialog).getByRole("group", { name: "笔记与注释关联图" });
  expect(within(graph).getByRole("button", { name: "笔记：缓存设计" })).toHaveClass("selected");
  expect(within(graph).getByRole("button", { name: "笔记：传输方案" })).toHaveClass("related");
  expect(within(graph).getByRole("button", { name: "笔记：独立研究" })).toHaveClass("dimmed");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "关联高亮范围" }), { target: { value: "direct" } });
  expect(within(graph).getByRole("button", { name: "笔记：传输方案" })).toHaveClass("dimmed");
  expect(within(graph).getByRole("button", { name: "注释：零拷贝路径" })).toHaveClass("related");
});
it("creates a manual relationship and surfaces failed saves without pretending it was created", async () => {
  render(<Fixture/>); fireEvent.click(screen.getByText("缓存设计"));
  fireEvent.click(screen.getByRole("button", { name: /知识图谱/ }));
  const dialog = screen.getByRole("dialog", { name: "知识关联" });
  fireEvent.click(within(dialog).getByRole("button", { name: "手动建立关联" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "关联说明" }), { target: { value: "对比实验" } });
  vi.mocked(api.setNoteLink).mockRejectedValueOnce(new Error("写入失败"));
  const checkbox = within(dialog).getByRole("checkbox", { name: /独立研究/ });
  fireEvent.click(checkbox);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("写入失败");
  expect(checkbox).not.toBeChecked();
  vi.mocked(api.setNoteLink).mockResolvedValue({ ...knowledgeFixture, noteLinks: [...knowledgeFixture.noteLinks!, { id: "new", source: "note:a", target: "note:c", reason: "对比实验", createdBy: "manual", createdAt: "2026-11-06" }] });
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox).toBeChecked());
  expect(api.setNoteLink).toHaveBeenLastCalledWith("note:a", "note:c", true, "对比实验", "manual");
});
it("shows model suggestions and persists only the relationship explicitly accepted", async () => {
  vi.mocked(api.suggestNoteLinks).mockResolvedValue({ suggestions: [{ target: "note:c", reason: "对同一设计给出独立论据" }], candidateCount: 3, totalCount: 3 });
  vi.mocked(api.setNoteLink).mockResolvedValue(knowledgeFixture);
  render(<Fixture/>); fireEvent.click(screen.getByText("缓存设计"));
  fireEvent.click(screen.getByRole("button", { name: /知识图谱/ }));
  const dialog = screen.getByRole("dialog", { name: "知识关联" });
  fireEvent.click(within(dialog).getByRole("button", { name: "AI 建议关联" }));
  expect(await within(dialog).findByText("对同一设计给出独立论据")).toBeVisible();
  expect(api.setNoteLink).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "建立关联" }));
  await waitFor(() => expect(api.setNoteLink).toHaveBeenCalledWith("note:a", "note:c", true, "对同一设计给出独立论据", "model"));
});

it("ignores a late model reply after the user selects another note", async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.suggestNoteLinks>>) => void;
  vi.mocked(api.suggestNoteLinks).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<Fixture/>); fireEvent.click(screen.getByText("缓存设计"));
  fireEvent.click(screen.getByRole("button", { name: /知识图谱/ }));
  const dialog = screen.getByRole("dialog", { name: "知识关联" });
  fireEvent.click(within(dialog).getByRole("button", { name: "AI 建议关联" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "笔记：传输方案" }));
  finish({ suggestions: [{ target: "note:c", reason: "属于旧选中项的建议" }], candidateCount: 2, totalCount: 2 });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "AI 建议关联" })).toBeEnabled());
  expect(within(dialog).queryByText("属于旧选中项的建议")).not.toBeInTheDocument();
  expect(api.setNoteLink).not.toHaveBeenCalled();
});

it("edits an annotation in the detail panel while retaining its original excerpt", async () => {
  vi.mocked(api.updateAnnotation).mockResolvedValue({ ...knowledgeFixture, annotations: knowledgeFixture.annotations.map((a) => a.id === "x" ? { ...a, note: "新的阅读理解" } : a) });
  render(<Fixture/>); fireEvent.click(screen.getByRole("button", { name: /零拷贝路径/ }));
  expect(screen.queryByRole("dialog", { name: "知识关联" })).not.toBeInTheDocument();
  const dialog = screen.getByRole("region", { name: /注释内容/ });
  fireEvent.click(within(dialog).getByRole("button", { name: "编辑注释" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "注释正文" }), { target: { value: "新的阅读理解" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateAnnotation).toHaveBeenCalledWith("x", "新的阅读理解"));
  expect(within(dialog).getByText("Zero-copy memory transfer", { selector: "blockquote" })).toBeVisible();
});

it("expands only the clicked note and never opens the graph without its dedicated button", () => {
  render(<Fixture/>);
  fireEvent.click(screen.getByRole("button", { name: /缓存设计/, expanded: false }));
  const content = screen.getByRole("region", { name: "笔记内容：缓存设计" });
  expect(within(content).getByText("KV cache 的设计与优化")).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "知识关联" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "笔记与注释关联图" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /传输方案/, expanded: false }));
  expect(screen.queryByRole("region", { name: "笔记内容：缓存设计" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "笔记内容：传输方案" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /传输方案/, expanded: true }));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /知识图谱/ }));
  expect(screen.getByRole("dialog", { name: "知识关联" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭知识关联" }));
  expect(screen.queryByRole("dialog", { name: "知识关联" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
