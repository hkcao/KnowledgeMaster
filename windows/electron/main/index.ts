import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import type {
  AgentResult,
  AppSettings,
  BootstrapData,
  ImportResult,
  KnowledgeData,
  KnowledgeDocument
} from "../../src/types";

const emptyData = (): KnowledgeData => ({
  version: 5,
  documents: [],
  topics: [],
  documentTopics: [],
  bookmarks: [],
  annotations: [],
  conversations: [],
  topicSummaries: [],
  summaryNotes: []
});

const defaultSettings = (): AppSettings => ({
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-chat",
  chatBackend: "direct",
  chatPlacement: "right",
  libraryVisible: true,
  apiContextMode: "relevantFragments",
  visionEnabled: false,
  libraryRoot: process.env.KM_LIBRARY_ROOT || join(app.getPath("documents"), "KnowledgeMaster Library"),
  hasAPIKey: false
});

let mainWindow: BrowserWindow | null = null;
let data = emptyData();
let settings = {} as AppSettings;

const configPath = () => join(app.getPath("userData"), "settings.json");
const secretPath = () => join(app.getPath("userData"), "api-key.bin");
const metadataPath = () => join(settings.libraryRoot, "knowledge.json");
const documentsPath = () => join(settings.libraryRoot, "source", "documents");
const indexPath = () => join(settings.libraryRoot, "source", "index");
const notesPath = () => join(settings.libraryRoot, "source", "notes");
const generatedPath = () => join(settings.libraryRoot, "source", "generated");

function normalizeData(value: Partial<KnowledgeData> | null): KnowledgeData {
  const fallback = emptyData();
  return {
    ...fallback,
    ...(value ?? {}),
    documents: value?.documents ?? [],
    topics: value?.topics ?? [],
    documentTopics: value?.documentTopics ?? [],
    bookmarks: value?.bookmarks ?? [],
    annotations: value?.annotations ?? [],
    conversations: value?.conversations ?? [],
    topicSummaries: value?.topicSummaries ?? [],
    summaryNotes: value?.summaryNotes ?? []
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareLibrary(root = settings.libraryRoot): Promise<void> {
  await Promise.all([
    mkdir(join(root, "source", "documents"), { recursive: true }),
    mkdir(join(root, "source", "downloads", "pending"), { recursive: true }),
    mkdir(join(root, "source", "generated"), { recursive: true }),
    mkdir(join(root, "source", "index"), { recursive: true }),
    mkdir(join(root, "source", "notes"), { recursive: true })
  ]);
}

async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const backup = `${path}.bak`;
  await writeFile(temporary, content);
  if (await exists(path)) {
    await copyFile(path, backup);
    await unlink(path).catch(() => undefined);
  }
  await rename(temporary, path);
}

async function loadSettings(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  let saved: Partial<AppSettings> = {};
  try {
    saved = JSON.parse(await readFile(configPath(), "utf8")) as Partial<AppSettings>;
  } catch {
    // First launch.
  }
  settings = { ...defaultSettings(), ...saved, hasAPIKey: await exists(secretPath()) };
  await prepareLibrary();
}

async function saveSettings(): Promise<void> {
  const { hasAPIKey: _hasAPIKey, ...persisted } = settings;
  await atomicWrite(configPath(), JSON.stringify(persisted, null, 2));
}

async function loadData(): Promise<void> {
  try {
    data = normalizeData(JSON.parse(await readFile(metadataPath(), "utf8")) as KnowledgeData);
  } catch {
    const backup = `${metadataPath()}.bak`;
    try {
      data = normalizeData(JSON.parse(await readFile(backup, "utf8")) as KnowledgeData);
    } catch {
      data = emptyData();
    }
  }
}

async function saveData(next = data): Promise<void> {
  data = normalizeData(next);
  await atomicWrite(metadataPath(), JSON.stringify(data, null, 2));
}

function assertLibraryPath(storedPath: string): string {
  const root = resolve(settings.libraryRoot);
  const target = resolve(root, storedPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("文件路径超出知识库范围");
  }
  return target;
}

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "document";
}

function relativeLibraryPath(path: string): string {
  return relative(settings.libraryRoot, path).split(sep).join("/");
}

async function walk(input: string): Promise<string[]> {
  const info = await stat(input);
  if (info.isFile()) return [input];
  if (!info.isDirectory()) return [];
  const children = await readdir(input);
  const nested = await Promise.all(children.map((name) => walk(join(input, name))));
  return nested.flat();
}

const acceptedExtensions = new Set([".pdf", ".doc", ".docx", ".html", ".htm", ".md", ".markdown", ".txt"]);

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(p|div|section|article|h[1-6]|li|tr|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocument(path: string, extension: string): Promise<{ text: string; pageCount?: number }> {
  try {
    if (extension === "pdf") {
      const parsed = await pdfParse(await readFile(path));
      return { text: parsed.text, pageCount: parsed.numpages };
    }
    if (extension === "docx") {
      const parsed = await mammoth.extractRawText({ path });
      return { text: parsed.value };
    }
    if (extension === "html" || extension === "htm") {
      return { text: stripHtml(await readFile(path, "utf8")) };
    }
    if (extension === "doc") {
      return { text: "旧版 .doc 文件请使用 Microsoft Word 打开；转换为 .docx 后可建立全文索引。" };
    }
    return { text: await readFile(path, "utf8") };
  } catch (error) {
    return { text: "", pageCount: undefined };
  }
}

async function importOne(path: string, sourceURL?: string): Promise<{ document?: KnowledgeDocument; message?: string }> {
  const extension = extname(path).toLowerCase().slice(1);
  if (!acceptedExtensions.has(`.${extension}`)) {
    return { message: `跳过不支持的文件：${basename(path)}` };
  }
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = basename(path);
  if (data.documents.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return { message: `同名文件已存在：${name}` };
  }
  if (data.documents.some((item) => item.sha256 === sha256)) {
    return { message: `相同内容已存在：${name}` };
  }
  const id = randomUUID();
  const target = join(documentsPath(), `${id}--${safeFilename(name)}`);
  await copyFile(path, target);
  const extracted = await extractDocument(target, extension);
  const document: KnowledgeDocument = {
    id,
    name,
    displayName: null,
    extension,
    size: bytes.length,
    sha256,
    storedPath: relativeLibraryPath(target),
    importedAt: new Date().toISOString(),
    status: "ready",
    pageCount: extracted.pageCount ?? null,
    sourceURL: sourceURL ?? null
  };
  data.documents.push(document);
  await writeFile(join(indexPath(), `${id}.txt`), extracted.text, "utf8");
  return { document };
}

async function importPaths(inputPaths: string[]): Promise<ImportResult> {
  const all = (await Promise.all(inputPaths.map(walk))).flat();
  const messages: string[] = [];
  const importedIds: string[] = [];
  for (const path of all) {
    const result = await importOne(path);
    if (result.document) importedIds.push(result.document.id);
    if (result.message) messages.push(result.message);
  }
  await saveData();
  return { data, messages, importedIds };
}

async function importUrl(value: string): Promise<ImportResult> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS 地址");
  const response = await net.fetch(url.toString());
  if (!response.ok) throw new Error(`网页下载失败：HTTP ${response.status}`);
  const html = await response.text();
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || url.hostname;
  const id = randomUUID();
  const name = `${safeFilename(title)}.html`;
  const temporary = join(app.getPath("temp"), `${id}.html`);
  await writeFile(temporary, html, "utf8");
  const result = await importOne(temporary, url.toString());
  await unlink(temporary).catch(() => undefined);
  await saveData();
  return {
    data,
    messages: result.message ? [result.message] : [],
    importedIds: result.document ? [result.document.id] : []
  };
}

async function getAPIKey(): Promise<string> {
  if (!(await exists(secretPath()))) return "";
  const encrypted = await readFile(secretPath());
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 凭据加密当前不可用");
  return safeStorage.decryptString(encrypted);
}

async function setAPIKey(value: string): Promise<void> {
  if (!value) {
    await unlink(secretPath()).catch(() => undefined);
    settings.hasAPIKey = false;
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 凭据加密当前不可用");
  await writeFile(secretPath(), safeStorage.encryptString(value));
  settings.hasAPIKey = true;
}

async function completion(messages: Array<{ role: string; content: string }>): Promise<string> {
  const key = await getAPIKey();
  if (!key) throw new Error("请先在设置中填写 API Key");
  const base = settings.baseURL.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const response = await net.fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: settings.model, messages, temperature: 0.2 })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `模型服务返回 HTTP ${response.status}`);
  const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = parsed.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("模型没有返回内容");
  return answer;
}

function runProcess(command: string, args: string[], input?: string, cwd?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: true,
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} 退出，代码 ${code}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function runAgent(
  backend: "claudeCode" | "codex",
  prompt: string,
  documentIds: string[]
): Promise<AgentResult> {
  const runID = randomUUID();
  const workspace = join(generatedPath(), runID);
  const source = join(workspace, "documents");
  await mkdir(source, { recursive: true });
  const selected = data.documents.filter((item) => documentIds.includes(item.id) && item.storedPath);
  for (const document of selected) {
    await copyFile(assertLibraryPath(document.storedPath!), join(source, safeFilename(document.name)));
  }
  const policy = [
    "你正在 KnowledgeMaster 的只读研究工作区中工作。",
    "documents/ 是用户授权的原始资料副本，不得修改或删除。",
    "需要生成文件时写入当前工作区根目录，并在回答中说明文件名。",
    "",
    prompt
  ].join("\n");
  const started = new Date().toISOString();
  try {
    const answer =
      backend === "codex"
        ? await runProcess("codex", ["exec", "--sandbox", "workspace-write", "-"], policy, workspace)
        : await runProcess("claude", ["-p", policy, "--output-format", "text"], undefined, workspace);
    const generated = (await readdir(workspace))
      .filter((name) => name !== "documents")
      .map((name) => `source/generated/${runID}/${name}`);
    return {
      answer,
      generatedFiles: generated,
      traceEvents: [
        { id: randomUUID(), kind: "status", title: `启动 ${backend}`, createdAt: started },
        {
          id: randomUUID(),
          kind: "completed",
          title: "Agent 已完成",
          detail: generated.length ? `生成 ${generated.length} 个文件` : undefined,
          createdAt: new Date().toISOString()
        }
      ]
    };
  } catch (error) {
    throw new Error(`无法运行 ${backend}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function registerHandlers(): void {
  ipcMain.handle("km:bootstrap", async (): Promise<BootstrapData> => ({ data, settings }));
  ipcMain.handle("km:save-data", async (_event, next: KnowledgeData) => saveData(next));
  ipcMain.handle("km:choose-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "研究资料", extensions: [...acceptedExtensions].map((value) => value.slice(1)) }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("km:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("km:import-paths", (_event, paths: string[]) => importPaths(paths));
  ipcMain.handle("km:import-url", (_event, url: string) => importUrl(url));
  ipcMain.handle("km:choose-library", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("km:switch-library", async (_event, nextRoot: string, migrate: boolean) => {
    if (!isAbsolute(nextRoot)) throw new Error("知识库路径必须是绝对路径");
    const oldRoot = settings.libraryRoot;
    await prepareLibrary(nextRoot);
    if (migrate && resolve(oldRoot) !== resolve(nextRoot)) {
      await cp(oldRoot, nextRoot, { recursive: true, force: false, errorOnExist: false });
    }
    settings.libraryRoot = nextRoot;
    await saveSettings();
    await prepareLibrary();
    await loadData();
    return { data, settings } satisfies BootstrapData;
  });
  ipcMain.handle("km:read-document", async (_event, storedPath: string) => {
    const path = assertLibraryPath(storedPath);
    const document = data.documents.find((item) => item.storedPath === storedPath);
    const indexed = document ? join(indexPath(), `${document.id}.txt`) : "";
    const text = indexed && (await exists(indexed)) ? await readFile(indexed, "utf8") : "";
    const encoded = Buffer.from(storedPath, "utf8").toString("base64url");
    return { text, fileUrl: `km-file://open/${encoded}` };
  });
  ipcMain.handle("km:write-note", async (_event, storedPath: string | null, title: string, content: string) => {
    const target = storedPath
      ? assertLibraryPath(storedPath)
      : join(notesPath(), `${randomUUID()}--${safeFilename(title)}.md`);
    await atomicWrite(target, content);
    return relativeLibraryPath(target);
  });
  ipcMain.handle("km:export-document", async (_event, documentId: string) => {
    const document = data.documents.find((item) => item.id === documentId);
    if (!document?.storedPath) return null;
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: document.name });
    if (result.canceled || !result.filePath) return null;
    await copyFile(assertLibraryPath(document.storedPath), result.filePath);
    return result.filePath;
  });
  ipcMain.handle("km:open-external", async (_event, storedPath: string) => {
    const error = await shell.openPath(assertLibraryPath(storedPath));
    if (error) throw new Error(error);
  });
  ipcMain.handle("km:update-settings", async (_event, patch: Partial<AppSettings> & { apiKey?: string }) => {
    const { apiKey, libraryRoot: _root, hasAPIKey: _keyFlag, ...safePatch } = patch;
    settings = { ...settings, ...safePatch };
    if (apiKey !== undefined) await setAPIKey(apiKey);
    await saveSettings();
    return settings;
  });
  ipcMain.handle("km:complete", (_event, messages) => completion(messages));
  ipcMain.handle("km:run-agent", (_event, backend, prompt, documentIds) =>
    runAgent(backend, prompt, documentIds)
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f6f4ef",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f6f4ef", symbolColor: "#26352f", height: 38 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: true
    }
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: "km-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

app.whenReady().then(async () => {
  await loadSettings();
  await loadData();
  protocol.handle("km-file", async (request) => {
    const url = new URL(request.url);
    const encoded = url.pathname.replace(/^\//, "");
    const storedPath = Buffer.from(encoded, "base64url").toString("utf8");
    return net.fetch(pathToFileURL(assertLibraryPath(storedPath)).toString());
  });
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
