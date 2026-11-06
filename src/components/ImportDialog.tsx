import { useRef, useState } from "react";
import { Languages } from "lucide-react";
import { api } from "../api";
import type { KnowledgeData, UUID } from "../types";
import { translateDocument } from "../translation";

export default function ImportDialog({ paths, onData, onComplete }: {
  paths: string[];
  onData: (data: KnowledgeData) => void;
  onComplete: (ids: UUID[]) => void;
}) {
  const [translate, setTranslate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const ids = useRef<UUID[]>([]);
  const cancelled = useRef(false);

  async function start() {
    setBusy(true); setDetail("正在导入原文…");
    const notes: string[] = [];
    try {
      const before = await api.bootstrap();
      notes.push(...await api.importFiles(paths));
      const after = await api.bootstrap();
      onData(after.data);
      const previous = new Set(before.data.documents.map((d) => d.id));
      const imported = after.data.documents.filter((d) => !previous.has(d.id));
      ids.current = imported.map((d) => d.id);
      if (translate) {
        for (const document of imported) {
          if (cancelled.current) break;
          try {
            const next = await translateDocument(document, (text) => setDetail(`${document.name}：${text}`), () => cancelled.current);
            if (next) onData(next);
            notes.push(`已生成中文文档：${document.name}`);
          } catch (error) { notes.push(`${document.name}：${String(error)}`); }
        }
        if (cancelled.current) notes.push("已取消后续翻译；成功导入的原文和已完成的译文均已保留。");
      }
    } catch (error) { notes.push(String(error)); }
    finally { setBusy(false); setCompleted(true); setMessages(notes); setDetail(""); }
  }

  return <div className="modal-backdrop"><section className="modal import-options" role="dialog" aria-modal="true" aria-labelledby="import-options-title">
    <h2 id="import-options-title"><Languages size={20} />导入资料</h2>
    {!completed && <>
      <p>{paths.length} 个文件或目录</p>
      <label><input type="checkbox" checked={translate} disabled={busy} onChange={(event) => setTranslate(event.target.checked)} />导入后全文翻译为中文</label>
      <p className="muted">使用设置中的翻译方式，保留原文和图片，另存中文文档。阅读时可切换段落交替或左右同步。文字 PDF 保留页面位置；扫描页保留图片并在下方显示 OCR 译文。DOC 请先转为 DOCX。</p>
    </>}
    {detail && <p role="status">{detail}</p>}
    {!!messages.length && <div className="import-results" role="status">{messages.map((message, i) => <p key={i}>{message}</p>)}</div>}
    <div className="modal-actions">
      {completed ? <button className="primary" onClick={() => onComplete(ids.current)}>完成</button> : busy ?
        <button onClick={() => { cancelled.current = true; setDetail("正在结束当前请求并保留原文…"); }}>取消后续翻译</button> : <>
          <button onClick={() => onComplete([])}>取消</button>
          <button className="primary" onClick={() => void start()}>开始导入</button>
        </>}
    </div>
  </section></div>;
}
