import { useState } from "react";
import { useStore } from "../../state/store";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, data } = useStore();
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult("正在测试…");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<string>("test_api_connection", {
        model: settings.model,
        baseUrl: settings.base_url,
      });
      setTestResult(result);
    } catch (e: any) {
      setTestResult(`连接失败：${e}`);
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50" onClick={onClose}>
      <div className="bg-[var(--color-bg)] rounded-xl shadow-2xl w-[660px] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] px-6 py-4 flex items-center">
          <h2 className="text-lg font-bold">设置</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm px-3 py-1.5 bg-[var(--color-accent)] text-white rounded-md">
            完成
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Chat backend */}
          <section>
            <h3 className="text-sm font-semibold mb-3 text-secondary uppercase tracking-wide">聊天后端</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm w-24 shrink-0">回答方式</label>
                <select
                  value={settings.chat_backend}
                  onChange={(e) => useStore.setState({ settings: { ...settings, chat_backend: e.target.value } })}
                  className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)]"
                >
                  <option value="direct">直接 API</option>
                  <option value="claude_code">Claude Code</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
              <p className="text-xs text-secondary ml-[108px]">
                Agent 模式需要先在终端安装并登录对应的 CLI
              </p>
            </div>
          </section>

          {/* API Settings */}
          {settings.chat_backend === "direct" && (
            <section>
              <h3 className="text-sm font-semibold mb-3 text-secondary uppercase tracking-wide">模型连接</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-sm w-24 shrink-0">服务商</label>
                  <select
                    value={settings.provider}
                    onChange={(e) => {
                      const p = e.target.value;
                      const defaults: Record<string, { base_url: string; model: string }> = {
                        deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat" },
                        glm: { base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
                        custom: { base_url: settings.base_url, model: settings.model },
                      };
                      const d = defaults[p] || defaults.custom;
                      useStore.setState({ settings: { ...settings, provider: p, base_url: d.base_url, model: d.model } });
                    }}
                    className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)]"
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="glm">智谱 GLM</option>
                    <option value="custom">其他 OpenAI 兼容服务</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm w-24 shrink-0">Base URL</label>
                  <input
                    type="text"
                    value={settings.base_url}
                    onChange={(e) => useStore.setState({ settings: { ...settings, base_url: e.target.value } })}
                    className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)] font-mono"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm w-24 shrink-0">模型名称</label>
                  <input
                    type="text"
                    value={settings.model}
                    onChange={(e) => useStore.setState({ settings: { ...settings, model: e.target.value } })}
                    className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm w-24 shrink-0">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入后保存…"
                    className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)]"
                  />
                </div>
                <div className="flex items-center gap-2 ml-[108px]">
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-hover)] disabled:opacity-50"
                  >
                    {testing ? "测试中…" : "测试连接"}
                  </button>
                  {testResult && (
                    <span className={`text-xs ${testResult.includes("失败") ? "text-red-500" : "text-green-600"}`}>
                      {testResult}
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2 ml-[108px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vision_enabled}
                    onChange={(e) => useStore.setState({ settings: { ...settings, vision_enabled: e.target.checked } })}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-xs">模型支持图片输入</span>
                </label>
              </div>
            </section>
          )}

          {/* Layout */}
          <section>
            <h3 className="text-sm font-semibold mb-3 text-secondary uppercase tracking-wide">界面布局</h3>
            <div className="flex items-center gap-3">
              <label className="text-sm w-24 shrink-0">问答位置</label>
              <select
                value={settings.chat_placement}
                onChange={(e) => useStore.setState({
                  settings: { ...settings, chat_placement: e.target.value },
                  chatPlacement: e.target.value as any,
                })}
                className="flex-1 text-sm px-3 py-1.5 border border-[var(--color-border)] rounded-md bg-[var(--color-bg)]"
              >
                <option value="right">右侧</option>
                <option value="bottom">底部</option>
                <option value="sidebar">左侧合并</option>
                <option value="hidden">隐藏</option>
              </select>
            </div>
          </section>

          {/* Library */}
          <section>
            <h3 className="text-sm font-semibold mb-3 text-secondary uppercase tracking-wide">知识库</h3>
            <p className="text-xs text-secondary font-mono break-all">
              {data ? `${data.documents.length} 份资料` : "加载中…"}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
