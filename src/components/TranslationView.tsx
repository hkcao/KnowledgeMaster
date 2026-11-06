import { useMemo, useRef } from "react";
import type { DocumentTranslation } from "../types";
import { interleaveTranslation, safeDocument } from "../translation";

/** Map the visible paragraph and its local progress instead of whole-document percentages. */
export function alignedScroll(source: HTMLElement, target: HTMLElement) {
  const origin = source.getBoundingClientRect().top;
  const anchors = [...source.querySelectorAll<HTMLElement>("[data-sync-id]")]
    .map((element) => ({ element, top: element.getBoundingClientRect().top - origin + source.scrollTop }))
    .sort((a, b) => a.top - b.top);
  if (!anchors.length) return 0;
  let index = 0;
  anchors.forEach((anchor, i) => { if (anchor.top <= source.scrollTop + 1) index = i; });
  const current = anchors[index];
  const next = anchors[index + 1];
  const counterpart = target.querySelector<HTMLElement>(`[data-sync-id="${current.element.dataset.syncId}"]`);
  if (!counterpart) return target.scrollTop;
  const top = counterpart.getBoundingClientRect().top - target.getBoundingClientRect().top + target.scrollTop;
  const nextTarget = next && target.querySelector<HTMLElement>(`[data-sync-id="${next.element.dataset.syncId}"]`);
  const end = nextTarget ? nextTarget.getBoundingClientRect().top - target.getBoundingClientRect().top + target.scrollTop : target.scrollHeight;
  const fraction = Math.max(0, Math.min(1, (source.scrollTop - current.top) / Math.max(1, (next?.top ?? source.scrollHeight) - current.top)));
  return Math.max(0, top + fraction * Math.max(0, end - top));
}

export default function TranslationView({ value, mode }: { value: DocumentTranslation; mode: "parallel" | "interleaved" }) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const locked = useRef<HTMLElement | null>(null);
  const content = useMemo(() => ({
    original: safeDocument(value.originalHtml).body.innerHTML,
    translated: safeDocument(value.translatedHtml).body.innerHTML,
    interleaved: mode === "interleaved" ? interleaveTranslation(value) : ""
  }), [value, mode]);

  function synchronize(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (!target || locked.current === source) { locked.current = null; return; }
    const next = alignedScroll(source, target);
    const clamped = Math.min(Math.max(0, target.scrollHeight - target.clientHeight), next);
    if (Math.abs(target.scrollTop - clamped) < 1) return;
    locked.current = target;
    target.scrollTop = clamped;
  }
  if (mode === "interleaved") return <div className="translation-single translation-content" dangerouslySetInnerHTML={{ __html: content.interleaved }} />;
  return <div className="translation-parallel">
    <section><header>原文</header><div className="translation-content" ref={left} onScroll={(event) => synchronize(event.currentTarget, right.current)} dangerouslySetInnerHTML={{ __html: content.original }} /></section>
    <section><header>中文 · 同步滚动</header><div className="translation-content" lang="zh-CN" ref={right} onScroll={(event) => synchronize(event.currentTarget, left.current)} dangerouslySetInnerHTML={{ __html: content.translated }} /></section>
  </div>;
}
