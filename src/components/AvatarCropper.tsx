import { useEffect, useRef, useState } from "react";
import { Loader2, X, Check, ZoomIn } from "lucide-react";

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
  outputSize?: number;
};

export function AvatarCropper({ file, onCancel, onConfirm, outputSize = 512 }: Props) {
  const [imgUrl, setImgUrl] = useState<string>("");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const stageSize = 320;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const image = new Image();
    image.onload = () => {
      const base = Math.max(stageSize / image.width, stageSize / image.height);
      setImg(image);
      setMinZoom(base);
      setZoom(base);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Clamp offset so image always covers the crop area
  function clamp(ox: number, oy: number, z: number, image: HTMLImageElement) {
    const w = image.width * z;
    const h = image.height * z;
    const maxX = Math.max(0, (w - stageSize) / 2);
    const maxY = Math.max(0, (h - stageSize) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, ox)),
      y: Math.min(maxY, Math.max(-maxY, oy)),
    };
  }

  useEffect(() => {
    if (!img) return;
    const c = canvasRef.current;
    const p = previewRef.current;
    if (!c || !p) return;
    const draw = (canvas: HTMLCanvasElement, size: number) => {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      const w = img.width * zoom;
      const h = img.height * zoom;
      const scale = size / stageSize;
      ctx.drawImage(
        img,
        (size - w * scale) / 2 + offset.x * scale,
        (size - h * scale) / 2 + offset.y * scale,
        w * scale,
        h * scale,
      );
    };
    draw(c, stageSize);
    draw(p, 96);
  }, [img, zoom, offset]);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !img) return;
    const next = clamp(e.clientX - dragging.current.x, e.clientY - dragging.current.y, zoom, img);
    setOffset(next);
  }
  function onPointerUp() {
    dragging.current = null;
  }
  function onZoomChange(v: number) {
    if (!img) return;
    setZoom(v);
    setOffset((o) => clamp(o.x, o.y, v, img));
  }

  async function confirm() {
    if (!img) return;
    setSaving(true);
    try {
      const out = document.createElement("canvas");
      out.width = outputSize;
      out.height = outputSize;
      const ctx = out.getContext("2d")!;
      const w = img.width * zoom;
      const h = img.height * zoom;
      const scale = outputSize / stageSize;
      ctx.drawImage(
        img,
        (outputSize - w * scale) / 2 + offset.x * scale,
        (outputSize - h * scale) / 2 + offset.y * scale,
        w * scale,
        h * scale,
      );
      const blob: Blob = await new Promise((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error("Encode failed"))), "image/jpeg", 0.9),
      );
      await onConfirm(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Crop your avatar</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-start gap-4">
          <div
            className="relative overflow-hidden rounded-lg bg-black/40 touch-none"
            style={{ width: stageSize, height: stageSize }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas ref={canvasRef} width={stageSize} height={stageSize} className="block" />
            <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>

          <div className="hidden flex-col items-center gap-2 sm:flex">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Preview
            </span>
            <canvas
              ref={previewRef}
              width={96}
              height={96}
              className="rounded-full border border-white/10"
            />
            <canvas
              ref={(el) => {
                if (el && img) {
                  const ctx = el.getContext("2d")!;
                  ctx.clearRect(0, 0, 40, 40);
                  const w = img.width * zoom;
                  const h = img.height * zoom;
                  const scale = 40 / stageSize;
                  ctx.drawImage(
                    img,
                    (40 - w * scale) / 2 + offset.x * scale,
                    (40 - h * scale) / 2 + offset.y * scale,
                    w * scale,
                    h * scale,
                  );
                }
              }}
              width={40}
              height={40}
              className="rounded-full border border-white/10"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
          <input
            type="range"
            min={minZoom}
            max={minZoom * 4}
            step={0.01}
            value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))}
            className="flex-1 accent-primary"
            aria-label="Zoom"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || !img}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Uploading…" : "Save avatar"}
          </button>
        </div>

        {imgUrl ? null : null}
      </div>
    </div>
  );
}
