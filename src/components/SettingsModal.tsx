import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Eye, FolderOpen, KeyRound, Play, Save, Square, Terminal, X } from "lucide-react";
import { api } from "../api";
import type { AppSettings, BootstrapState, ChatBackend, UUID } from "../types";

export default function SettingsModal({
  state,
  onState,
  onClose
}: {
  state: BootstrapState;
  onState: (state: BootstrapState) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(state.settings);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("");
  const [testingAgent, setTestingAgent] = useState<{ backend: "claudeCode" | "codex"; runId: UUID } | null>(null);

  async function persist(next: AppSettings) {
    setSettings(next);
    await api.updateSettings(next);
    onState({ ...state, settings: next });
  }

  async function chooseRoot() {
    const selected = await open({ directory: true, multiple: false, defaultPath: state.rootPath });
    if (!selected) return;
    const migrate = state.data.documents.length === 0 || window.confirm("迁移现有知识库？\n确认会复制 source、主题、批注和对话；取消将直接打开或创建目标知识库。");
    try {
      onState(await api.setLibraryRoot(selected, migrate));
      setStatus("知识库目录已切换");
    } catch (value) {
      setStatus(String(value));
    }
  }

  async function testAgent(backend: "claudeCode" | "codex") {
    const runId = crypto.randomUUID();
    setTestingAgent({ backend, runId });
    setStatus(`正在测试 ${backend === "codex" ? "Codex" : "Claude Code"}…`);
    try {
      setStatus(await api.testAgent(backend, runId));
    } catch (value) {
      setStatus(String(value));
    } finally {
      setTestingAgent(null);
    }
  }

  function providerDefaults(provider: AppSettings["provider"]): AppSettings {
    if (provider === "deepseek") return { ...settings, provider, baseURL: "https://api.deepseek.com", model: "deepseek-chat" };
    if (provider === "glm") return { ...settings, provider, baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" };
    return { ...settings, provider };
  }

  return (
    <div className="modal-backdrop settings-backdrop">
      <section className="modal settings-modal">
        <header><h2>设置</h2><button className="icon-button" onClick={onClose}><X size={17} /></button></header>
        <div className="settings-scroll">
          <fieldset>
            <legend>聊天执行后端</legend>
            <label className="form-row"><span>默认回答方式</span><select value={settings.chatBackend} onChange={(event) => persist({ ...settings, chatBackend: event.target.value as ChatBackend })}>
              <option value="direct">直接 API</option><option value="claudeCode">Claude Code</option><option value="codex">Codex</option>
            </select></label>
            {(["claudeCode", "codex"] as const).map((backend) => (
              <div className="agent-setting" key={backend}>
                <strong>{backend === "codex" ? "Codex" : "Claude Code"}</strong>
                <code>{state.agentAvailability[backend] || `未检测到 ${backend === "codex" ? "Codex" : "Claude Code"} CLI`}</code>
                {testingAgent?.backend === backend ? (
                  <button className="danger" onClick={() => api.stopAgent(testingAgent.runId)}><Square size={14} />停止</button>
                ) : (
                  <button disabled={!state.agentAvailability[backend] || !!testingAgent} onClick={() => testAgent(backend)}><Play size={14} />测试</button>
                )}
              </div>
            ))}
            <p className="muted">Agent 只获得本轮所选原格式文件的独立只读副本；过程可实时展开并手动停止。下载资料需人工确认导入与虚拟主题。</p>
            <details>
              <summary>Claude Code / Codex 接入步骤</summary>
              <div className="instruction">
                <strong>macOS</strong>
                <code>Claude Code: npm install -g @anthropic-ai/claude-code{"\n"}Codex: brew install --cask codex</code>
                <strong>Windows</strong>
                <code>先安装 Node.js LTS，然后安装对应 CLI；也可使用 WinGet、Chocolatey 或 Scoop 提供的官方包。</code>
                <ol><li>在终端运行 claude 或 codex 并按提示登录。</li><li>确认 CLI 能独立回答。</li><li>完全退出并重新打开知屿。</li><li>在这里点击“测试”。</li></ol>
                <p>CLI 在另一台机器时，请在那台机器运行知屿并通过 iCloud/OneDrive 同步资料库，或本机改用直接 API；不能把本地临时路径直接交给远程 CLI。</p>
              </div>
            </details>
          </fieldset>

          <fieldset>
            <legend>模型连接</legend>
            <label className="form-row"><span>服务商</span><select value={settings.provider} onChange={(event) => persist(providerDefaults(event.target.value as AppSettings["provider"]))}>
              <option value="deepseek">DeepSeek</option><option value="glm">智谱 GLM</option><option value="custom">其他 OpenAI 兼容服务</option>
            </select></label>
            <label className="form-row"><span>API Base URL</span><input value={settings.baseURL} onChange={(event) => setSettings({ ...settings, baseURL: event.target.value })} onBlur={() => persist(settings)} /></label>
            <label className="form-row"><span>模型名称</span><input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} onBlur={() => persist(settings)} /></label>
            <label className="check-row"><input type="checkbox" checked={settings.visionEnabled} onChange={(event) => persist({ ...settings, visionEnabled: event.target.checked })} /><Eye size={15} />模型支持图片输入（发送 PDF 划词截图）</label>
            <label className="form-row"><span>API Key</span><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="输入后可保存或替换" /></label>
            <div className="button-row">
              <button disabled={!key} onClick={async () => { await api.saveApiKey(key); setKey(""); setStatus("API Key 已保存到系统凭据管理器"); }}><Save size={14} />保存 API Key</button>
              <button className="danger" onClick={async () => { await api.clearApiKey(); setStatus("API Key 已清除"); }}><KeyRound size={14} />清除</button>
              <button onClick={async () => {
                try { setStatus(await api.testApi()); } catch (value) { setStatus(String(value)); }
              }}><Play size={14} />测试连接</button>
            </div>
            <p className="muted">只有在直接 API 请求、测试连接、保存或清除时才访问 macOS Keychain / Windows Credential Manager。</p>
          </fieldset>

          <fieldset>
            <legend>知识库与 source 目录</legend>
            <code className="path-display">{state.rootPath}</code>
            <div className="button-row">
              <button onClick={chooseRoot}><FolderOpen size={14} />更改目录</button>
              <button onClick={() => api.revealPath()}><Terminal size={14} />在文件管理器中打开</button>
            </div>
            <p className="muted">{state.rootPath.includes("CloudDocs") ? "当前目录由 iCloud Drive 同步" : state.rootPath.toLocaleLowerCase().includes("onedrive") ? "当前目录由 OneDrive 同步" : "当前为本地目录"}</p>
          </fieldset>
          {status && <p className="settings-status">{status}</p>}
        </div>
        <div className="modal-actions"><button className="primary" onClick={onClose}>完成</button></div>
      </section>
    </div>
  );
}
