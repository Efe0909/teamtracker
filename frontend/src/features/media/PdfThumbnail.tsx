// PDF'nin ilk sayfasi. Motor ve worker yalniz PDF onizlemesi gerektiginde yuklenir.
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Icon } from "../../ui/icons";
import s from "./pdfThumbnail.module.css";

export function PdfThumbnail({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let stopped = false;
    let document: PDFDocumentLoadingTask | undefined;
    let render: RenderTask | undefined;
    setStatus("loading");
    const draw = async () => {
      const pdf = await import("pdfjs-dist");
      if (stopped) return;
      pdf.GlobalWorkerOptions.workerSrc = workerUrl;
      document = pdf.getDocument({ url, withCredentials: true, useSystemFonts: true });
      const loaded = await document.promise;
      if (stopped) return;
      const page = await loaded.getPage(1);
      const target = canvas.current;
      if (stopped || target === null) return;
      const original = page.getViewport({ scale: 1 });
      const scale = 250 * Math.min(window.devicePixelRatio || 1, 2) / Math.max(original.width, original.height);
      const viewport = page.getViewport({ scale });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, viewport });
      await render.promise;
      if (!stopped) setStatus("ready");
    };
    void draw().catch(() => { if (!stopped) setStatus("error"); });
    return () => {
      stopped = true;
      render?.cancel();
      void document?.destroy().catch(() => undefined);
    };
  }, [url]);
  return <span className={s.preview} aria-busy={status === "loading"}>
    <canvas ref={canvas} role="img" aria-label={`${name}, ilk sayfa`} hidden={status !== "ready"} />
    {status !== "ready" && <span className={s.message} role={status === "loading" ? "status" : undefined}>
      <Icon name="file" size={28} />{status === "loading" ? "Önizleme hazırlanıyor…" : "Önizleme yüklenemedi"}
    </span>}
  </span>;
}
