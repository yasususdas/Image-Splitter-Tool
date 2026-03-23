import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Download, ImagePlus, Trash2 } from "lucide-react";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function safeBaseName(filename) {
  const name = (filename || "image").replace(/\.[^.]+$/, "");
  return name.replace(/[\/:*?"<>|]+/g, "_").trim() || "image";
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

async function fileToBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);

    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return await createImageBitmap(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function canvasToBlob(canvas, type = "image/png") {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("toBlob failed"));
    }, type);
  });
}

function computeSizesEqual(length, parts) {
  const base = Math.floor(length / parts);
  const remainder = length - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function computeSizesPercent2(length, percent) {
  const raw = Math.round((length * percent) / 100);
  const cut = Math.max(1, Math.min(length - 1, raw));
  return [cut, length - cut];
}

async function splitBitmapToPngBlobs(bitmap, axis, mode, percent, parts) {
  const width = bitmap.width;
  const height = bitmap.height;
  const length = axis === "y" ? height : width;

  if (length <= 1) {
    throw new Error("分割方向の画像サイズが小さすぎるため、この画像は分割できません。");
  }

  if (mode === "equal" && parts > length) {
    throw new Error("分割数が画像サイズを超えています。より少ない分割数を指定してください。");
  }

  const sizes =
    mode === "percent2" ? computeSizesPercent2(length, percent) : computeSizesEqual(length, parts);

  let offset = 0;
  const output = [];

  for (let i = 0; i < sizes.length; i += 1) {
    const size = sizes[i];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Canvas 2D の初期化に失敗しました。");
    }

    if (axis === "y") {
      canvas.width = width;
      canvas.height = size;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, offset, width, size, 0, 0, width, size);
      output.push({
        blob: await canvasToBlob(canvas, "image/png"),
        index: i + 1,
        outW: width,
        outH: size,
        start: offset,
      });
    } else {
      canvas.width = size;
      canvas.height = height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, offset, 0, size, height, 0, 0, size, height);
      output.push({
        blob: await canvasToBlob(canvas, "image/png"),
        index: i + 1,
        outW: size,
        outH: height,
        start: offset,
      });
    }

    offset += size;
  }

  return { parts: output, w: width, h: height, axis, sizes };
}

export default function App() {
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const [zipName, setZipName] = useState("");
  const [axis, setAxis] = useState("y");
  const [mode, setMode] = useState("equal");
  const [equalParts, setEqualParts] = useState(2);
  const [percent, setPercent] = useState(50);

  useEffect(() => {
    return () => {
      if (zipUrl) {
        URL.revokeObjectURL(zipUrl);
      }
    };
  }, [zipUrl]);

  const totals = useMemo(() => {
    const count = items.length;
    const bytes = items.reduce((sum, item) => sum + (item.file?.size || 0), 0);
    return { count, bytes };
  }, [items]);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file && file.type.startsWith("image/"));
    if (files.length === 0) return;

    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        status: "queued",
        err: "",
        meta: null,
      })),
    ]);
  };

  const onPick = (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    addFiles(event.dataTransfer.files);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const clearAll = () => {
    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
    }

    setZipUrl("");
    setZipName("");
    setItems([]);
  };

  const removeOne = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const splitAndZip = async () => {
    if (items.length === 0 || busy) return;

    const parts = clampInt(equalParts, 2, 99);
    const pct = clampNum(percent, 0, 100);

    if (zipUrl) {
      URL.revokeObjectURL(zipUrl);
      setZipUrl("");
      setZipName("");
    }

    setBusy(true);
    setItems((prev) => prev.map((item) => ({ ...item, status: "processing", err: "" })));

    const zip = new JSZip();

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      let bitmap;

      try {
        bitmap = await fileToBitmap(item.file);
        const result = await splitBitmapToPngBlobs(
          bitmap,
          axis,
          mode === "percent2" ? "percent2" : "equal",
          pct,
          parts
        );

        const base = safeBaseName(item.file.name);
        result.parts.forEach((part) => {
          zip.file(`${base}_${pad3(part.index)}.png`, part.blob);
        });

        setItems((prev) => {
          const next = [...prev];
          const index = next.findIndex((entry) => entry.id === item.id);
          if (index >= 0) {
            next[index] = {
              ...next[index],
              status: "done",
              meta: {
                w: result.w,
                h: result.h,
                axis: result.axis,
                sizes: result.sizes,
              },
            };
          }
          return next;
        });
      } catch (error) {
        setItems((prev) => {
          const next = [...prev];
          const index = next.findIndex((entry) => entry.id === item.id);
          if (index >= 0) {
            next[index] = {
              ...next[index],
              status: "error",
              err: error?.message || String(error),
            };
          }
          return next;
        });
      } finally {
        if (bitmap && typeof bitmap.close === "function") {
          bitmap.close();
        }
      }
    }

    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const name = `split_images_${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      setZipUrl(url);
      setZipName(name);
    } finally {
      setBusy(false);
    }
  };

  const renderMeta = (meta) => {
    if (!meta?.sizes?.length) return null;

    const sizes = meta.sizes;
    const preview = sizes.length <= 4 ? sizes : [...sizes.slice(0, 3), "…"];
    const axisLabel = meta.axis === "x" ? "LR" : "TB";

    return (
      <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-neutral-700">
        {axisLabel} {meta.w}x{meta.h} →{" "}
        {preview.map((size, index) => (
          <span key={`${size}_${index}`}>
            {index ? " / " : ""}
            {meta.axis === "y" ? `${meta.w}x${size}` : `${size}x${meta.h}`}
          </span>
        ))}
        {sizes.length > 4 ? <span> ({sizes.length} parts)</span> : null}
      </span>
    );
  };

  const percentLabel = axis === "y" ? "上端から" : "左端から";

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-2">
          <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Browser Only
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">画像分割ツール</h1>
          <p className="max-w-2xl text-sm leading-6 text-neutral-600">
            画像をブラウザ内だけで上下または左右に分割し、まとめて ZIP ダウンロードできます。アップロード画像はサーバーへ送信されません。
          </p>
        </header>

        <div className="mt-8 grid gap-6">
          <div
            className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-neutral-200">
                  <ImagePlus className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-medium">画像を追加</div>
                  <div className="text-xs text-neutral-500">
                    ドラッグ&ドロップ / クリックで選択（PNG・JPG・WEBP など）
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  画像を選択
                </button>
                <button
                  type="button"
                  className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={splitAndZip}
                  disabled={busy || items.length === 0}
                >
                  <span className="inline-flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    ZIPを作成
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={clearAll}
                  disabled={busy || items.length === 0}
                >
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    全削除
                  </span>
                </button>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPick}
              className="hidden"
            />

            <div className="mt-5 grid gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="text-sm font-semibold text-neutral-900">分割設定</div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="text-xs font-semibold text-neutral-600">方向</div>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-neutral-800">
                      <input
                        type="radio"
                        name="axis"
                        value="y"
                        checked={axis === "y"}
                        onChange={() => setAxis("y")}
                        disabled={busy}
                      />
                      <span>縦方向（top / bottom）</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-neutral-800">
                      <input
                        type="radio"
                        name="axis"
                        value="x"
                        checked={axis === "x"}
                        onChange={() => setAxis("x")}
                        disabled={busy}
                      />
                      <span>横方向（left / right）</span>
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="text-xs font-semibold text-neutral-600">方式</div>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-neutral-800">
                      <input
                        type="radio"
                        name="mode"
                        value="equal"
                        checked={mode === "equal"}
                        onChange={() => setMode("equal")}
                        disabled={busy}
                      />
                      <span>整数等分（n等分）</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-neutral-800">
                      <input
                        type="radio"
                        name="mode"
                        value="percent2"
                        checked={mode === "percent2"}
                        onChange={() => setMode("percent2")}
                        disabled={busy}
                      />
                      <span>{percentLabel} n% で2分割</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="text-xs font-semibold text-neutral-600">n等分</div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="number"
                      min={2}
                      max={99}
                      step={1}
                      value={equalParts}
                      onChange={(event) => setEqualParts(clampInt(event.target.value, 2, 99))}
                      disabled={busy || mode !== "equal"}
                      className="w-28 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                    <div className="text-xs text-neutral-500">ファイル名は _001, _002, ... の連番です</div>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="text-xs font-semibold text-neutral-600">n%で2分割</div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={percent}
                      onChange={(event) => setPercent(clampNum(event.target.value, 0, 100))}
                      disabled={busy || mode !== "percent2"}
                      className="w-28 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                    <div className="text-xs text-neutral-500">{percentLabel} {percent}% の位置で分割します</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-white p-5 text-sm text-neutral-600">
              ここに画像をドロップ
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
              <span className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1">{totals.count} files</span>
              <span className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1">
                {formatBytes(totals.bytes)}
              </span>
              {busy ? (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-700">
                  processing...
                </span>
              ) : null}
              {zipUrl ? (
                <a
                  className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-700 underline"
                  href={zipUrl}
                  download={zipName || "split_images.zip"}
                >
                  ZIPをダウンロード
                </a>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6">
            <div className="mb-4 text-sm font-semibold text-neutral-900">キュー</div>

            {items.length === 0 ? (
              <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
                まだ画像がありません
              </div>
            ) : (
              <div className="grid gap-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-900">{item.file.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5">
                          {formatBytes(item.file.size)}
                        </span>
                        {item.meta ? renderMeta(item.meta) : null}
                        <span
                          className={
                            "rounded-full border px-2 py-0.5 " +
                            (item.status === "done"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : item.status === "error"
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : item.status === "processing"
                                  ? "border-sky-300 bg-sky-50 text-sky-700"
                                  : "border-neutral-200 bg-neutral-100 text-neutral-700")
                          }
                        >
                          {item.status}
                        </span>
                      </div>
                      {item.err ? <div className="mt-2 text-xs text-rose-700">{item.err}</div> : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-800 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => removeOne(item.id)}
                        disabled={busy}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs leading-relaxed text-neutral-500">
            <div className="font-semibold text-neutral-600">出力仕様</div>
            <ul className="mt-2 list-disc pl-5">
              <li>
                ファイル名: <span className="font-mono">元名_001.png</span>,{" "}
                <span className="font-mono">元名_002.png</span>, ...
              </li>
              <li>出力形式: PNG 固定</li>
              <li>処理はブラウザ内で完結し、画像はサーバーへ送信しません</li>
              <li>ZIP は生成後にそのままクリックでダウンロードできます</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
