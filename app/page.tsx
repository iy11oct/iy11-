"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type BeadColor = {
  code: string;
  hex: string;
  rgb: [number, number, number];
  group?: string;
};

type PatternCell = {
  code: string;
  hex: string;
  rgb: [number, number, number];
};

type PatternResult = {
  width: number;
  height: number;
  cells: PatternCell[];
  usage: Array<{
    code: string;
    hex: string;
    count: number;
  }>;
};

const presets = [
  { label: "29 x 29", width: 29, height: 29 },
  { label: "58 x 58", width: 58, height: 58 },
  { label: "87 x 87", width: 87, height: 87 },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const srgbToLinear = (value: number) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
};

const rgbToLab = ([r, g, b]: [number, number, number]) => {
  const rr = srgbToLinear(r);
  const gg = srgbToLinear(g);
  const bb = srgbToLinear(b);

  let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  let y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.0;
  let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;

  const pivot = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;

  x = pivot(x);
  y = pivot(y);
  z = pivot(z);

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
};

const labDistance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
};

export default function Home() {
  const [palette, setPalette] = useState<BeadColor[]>([]);
  const [paletteStatus, setPaletteStatus] = useState("正在加载 MARD 221 色卡");
  const [imageUrl, setImageUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [pattern, setPattern] = useState<PatternResult | null>(null);
  const [width, setWidth] = useState(58);
  const [height, setHeight] = useState(58);
  const [showCodes, setShowCodes] = useState(true);
  const [status, setStatus] = useState("上传图片后即可生成图纸");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const paletteLabs = useMemo(
    () =>
      palette.map((color) => ({
        ...color,
        lab: rgbToLab(color.rgb),
      })),
    [palette],
  );

  useEffect(() => {
    let mounted = true;
    fetch("/mard-221-colors.json")
      .then((response) => response.json())
      .then((data: { colors: BeadColor[]; count?: number }) => {
        if (!mounted) return;
        const colors = data.colors.filter((color) => color.rgb?.length === 3);
        setPalette(colors);
        setPaletteStatus(`MARD 221 色卡已加载：${colors.length} 色`);
      })
      .catch(() => {
        if (!mounted) return;
        setPaletteStatus("色卡加载失败，请刷新页面");
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (pattern) {
      drawPattern(pattern, showCodes);
    }
  }, [pattern, showCodes]);

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("请选择图片文件");
      return;
    }

    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }

    const nextUrl = URL.createObjectURL(file);
    setImageUrl(nextUrl);
    setImageName(file.name);
    setPattern(null);
    setStatus("图片已载入，可以选择尺寸并生成");
  };

  const handlePreset = (nextWidth: number, nextHeight: number) => {
    setWidth(nextWidth);
    setHeight(nextHeight);
  };

  const findNearestColor = (rgb: [number, number, number]) => {
    const lab = rgbToLab(rgb);
    let best = paletteLabs[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const color of paletteLabs) {
      const distance = labDistance(lab, color.lab);
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
      }
    }

    return best;
  };

  const generatePattern = () => {
    if (!imageRef.current || !imageUrl) {
      setStatus("请先上传一张图片");
      return;
    }

    if (!paletteLabs.length) {
      setStatus("色卡还没有加载完成");
      return;
    }

    const targetWidth = clamp(Math.round(width), 8, 160);
    const targetHeight = clamp(Math.round(height), 8, 160);
    setWidth(targetWidth);
    setHeight(targetHeight);

    const source = imageRef.current;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = targetWidth;
    sampleCanvas.height = targetHeight;
    const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const imageRatio = source.naturalWidth / source.naturalHeight;
    const targetRatio = targetWidth / targetHeight;
    let sx = 0;
    let sy = 0;
    let sw = source.naturalWidth;
    let sh = source.naturalHeight;

    if (imageRatio > targetRatio) {
      sw = source.naturalHeight * targetRatio;
      sx = (source.naturalWidth - sw) / 2;
    } else {
      sh = source.naturalWidth / targetRatio;
      sy = (source.naturalHeight - sh) / 2;
    }

    context.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
    const cells: PatternCell[] = [];
    const usageMap = new Map<string, { code: string; hex: string; count: number }>();

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      const rgb: [number, number, number] =
        alpha < 12
          ? [255, 255, 255]
          : [pixels[index], pixels[index + 1], pixels[index + 2]];
      const nearest = findNearestColor(rgb);
      cells.push({
        code: nearest.code,
        hex: nearest.hex,
        rgb: nearest.rgb,
      });

      const current = usageMap.get(nearest.code);
      if (current) {
        current.count += 1;
      } else {
        usageMap.set(nearest.code, {
          code: nearest.code,
          hex: nearest.hex,
          count: 1,
        });
      }
    }

    const usage = Array.from(usageMap.values()).sort((a, b) => b.count - a.count);
    const nextPattern = {
      width: targetWidth,
      height: targetHeight,
      cells,
      usage,
    };
    setPattern(nextPattern);
    setStatus(`已生成 ${targetWidth} x ${targetHeight} 图纸，共 ${usage.length} 个色号`);
  };

  const drawPattern = (currentPattern: PatternResult, withCodes: boolean) => {
    const canvas = patternCanvasRef.current;
    if (!canvas) return;

    const cellSize = currentPattern.width > 88 ? 16 : currentPattern.width > 58 ? 20 : 26;
    const labelEveryCell = withCodes && cellSize >= 20;
    const legendWidth = 0;
    canvas.width = currentPattern.width * cellSize + legendWidth;
    canvas.height = currentPattern.height * cellSize;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${Math.max(8, Math.floor(cellSize * 0.34))}px Arial`;

    currentPattern.cells.forEach((cell, index) => {
      const x = (index % currentPattern.width) * cellSize;
      const y = Math.floor(index / currentPattern.width) * cellSize;
      context.fillStyle = cell.hex;
      context.fillRect(x, y, cellSize, cellSize);
      context.strokeStyle = "rgba(31, 41, 55, 0.18)";
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);

      if (labelEveryCell) {
        const brightness = cell.rgb[0] * 0.299 + cell.rgb[1] * 0.587 + cell.rgb[2] * 0.114;
        context.fillStyle = brightness > 150 ? "#202020" : "#ffffff";
        context.fillText(cell.code, x + cellSize / 2, y + cellSize / 2);
      }
    });
  };

  const downloadPattern = () => {
    if (!pattern || !patternCanvasRef.current) {
      setStatus("请先生成图纸");
      return;
    }

    const link = document.createElement("a");
    link.download = `拼豆图纸-${pattern.width}x${pattern.height}.png`;
    link.href = patternCanvasRef.current.toDataURL("image/png");
    link.click();
  };

  const downloadUsage = () => {
    if (!pattern) {
      setStatus("请先生成图纸");
      return;
    }

    const lines = [
      "色号,数量",
      ...pattern.usage.map((item) => `${item.code},${item.count}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.download = `拼豆用量-${pattern.width}x${pattern.height}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="min-h-screen bg-[#f7f3eb] text-[#1f2933]">
      <section className="border-b border-[#ded6c8] bg-[#fffdf8]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-[#577069]">图片转拼豆图纸</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal sm:text-4xl">
              上传图片，生成可保存的拼豆图纸
            </h1>
          </div>
          <div className="rounded-lg border border-[#ded6c8] bg-[#f8fbf6] px-4 py-3 text-sm text-[#46645d]">
            {paletteStatus}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 sm:px-8 lg:grid-cols-[360px_minmax(0,1fr)_300px]">
        <aside className="rounded-lg border border-[#ded6c8] bg-[#fffdf8] p-4 shadow-sm">
          <h2 className="text-lg font-semibold">设置</h2>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-[#4a5562]">上传图片</span>
            <input
              className="mt-2 block w-full rounded-md border border-[#cfc6b8] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#315c58] file:px-3 file:py-2 file:text-white"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleUpload}
            />
          </label>

          {imageUrl ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-[#ded6c8] bg-[#f9f5ec]">
              <img
                ref={imageRef}
                src={imageUrl}
                alt={imageName || "已上传图片"}
                className="h-48 w-full object-contain"
                onLoad={() => setStatus("图片已准备好，可以生成")}
              />
            </div>
          ) : (
            <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed border-[#c4b9aa] bg-[#f9f5ec] text-sm text-[#6f6254]">
              图片预览
            </div>
          )}

          <div className="mt-5">
            <p className="text-sm font-medium text-[#4a5562]">图纸大小</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`rounded-md border px-2 py-2 text-sm font-medium ${
                    width === preset.width && height === preset.height
                      ? "border-[#315c58] bg-[#315c58] text-white"
                      : "border-[#cfc6b8] bg-white text-[#3b4650]"
                  }`}
                  onClick={() => handlePreset(preset.width, preset.height)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label>
              <span className="text-sm font-medium text-[#4a5562]">宽</span>
              <input
                className="mt-1 w-full rounded-md border border-[#cfc6b8] bg-white px-3 py-2"
                type="number"
                min={8}
                max={160}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </label>
            <label>
              <span className="text-sm font-medium text-[#4a5562]">高</span>
              <input
                className="mt-1 w-full rounded-md border border-[#cfc6b8] bg-white px-3 py-2"
                type="number"
                min={8}
                max={160}
                value={height}
                onChange={(event) => setHeight(Number(event.target.value))}
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-md border border-[#ded6c8] bg-[#f8fbf6] px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={showCodes}
              onChange={(event) => setShowCodes(event.target.checked)}
            />
            显示格子色号
          </label>

          <button
            type="button"
            className="mt-5 w-full rounded-md bg-[#315c58] px-4 py-3 font-semibold text-white shadow-sm"
            onClick={generatePattern}
          >
            生成图纸
          </button>

          <p className="mt-3 text-sm text-[#65706c]">{status}</p>
        </aside>

        <section className="min-h-[560px] rounded-lg border border-[#ded6c8] bg-[#fffdf8] p-4 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-[#e5ded2] pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">图纸预览</h2>
              <p className="text-sm text-[#65706c]">
                按中心裁剪生成，每个格子对应一颗拼豆
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[#315c58] bg-white px-3 py-2 text-sm font-medium text-[#315c58]"
                onClick={downloadPattern}
              >
                保存 PNG
              </button>
              <button
                type="button"
                className="rounded-md border border-[#cfc6b8] bg-white px-3 py-2 text-sm font-medium text-[#3b4650]"
                onClick={downloadUsage}
              >
                保存用量
              </button>
            </div>
          </div>

          <div className="mt-4 flex min-h-[470px] items-center justify-center overflow-auto rounded-lg bg-[#eee7dc] p-4">
            {pattern ? (
              <canvas
                ref={patternCanvasRef}
                className="max-h-none max-w-none rounded bg-white shadow"
                aria-label="拼豆图纸预览"
              />
            ) : (
              <div className="max-w-sm text-center text-[#6f6254]">
                <p className="text-base font-medium">还没有生成图纸</p>
                <p className="mt-2 text-sm">
                  上传图片后选择尺寸，点击生成即可看到像素化拼豆图纸。
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-lg border border-[#ded6c8] bg-[#fffdf8] p-4 shadow-sm">
          <h2 className="text-lg font-semibold">用量清单</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-[#f8fbf6] p-3">
              <p className="text-[#65706c]">总颗数</p>
              <p className="mt-1 text-2xl font-semibold">
                {pattern ? pattern.width * pattern.height : 0}
              </p>
            </div>
            <div className="rounded-md bg-[#f8fbf6] p-3">
              <p className="text-[#65706c]">色号数</p>
              <p className="mt-1 text-2xl font-semibold">
                {pattern ? pattern.usage.length : 0}
              </p>
            </div>
          </div>

          <div className="mt-4 max-h-[520px] overflow-auto">
            {pattern ? (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-[#fffdf8]">
                  <tr className="border-b border-[#e5ded2] text-left">
                    <th className="py-2 font-medium">颜色</th>
                    <th className="py-2 font-medium">色号</th>
                    <th className="py-2 text-right font-medium">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {pattern.usage.map((item) => (
                    <tr key={item.code} className="border-b border-[#eee8dd]">
                      <td className="py-2">
                        <span
                          className="block h-6 w-6 rounded border border-black/10"
                          style={{ backgroundColor: item.hex }}
                        />
                      </td>
                      <td className="py-2 font-medium">{item.code}</td>
                      <td className="py-2 text-right">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-md bg-[#f9f5ec] p-4 text-sm text-[#6f6254]">
                生成后会显示每个色号需要多少颗。
              </p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
