"use client";

import {
  ChangeEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { imageFileToBeads } from "./vendor/jett-perler/imageToBeads";

type Color = { code: string; hex: string; rgb: [number, number, number] };
type Pattern = {
  width: number;
  height: number;
  cells: Color[];
  usage: Array<Color & { count: number }>;
};
type HistoryItem = Pattern & {
  id: string;
  sourceName: string;
  paletteMode: PaletteMode;
  styleMode: StyleMode;
  friendliness: Friendliness;
  preview: string;
};
type PaletteMode = "common36" | "common48" | "mard221";
type StyleMode = "photo" | "maker" | "cartoon";
type Friendliness = "detail" | "balanced" | "easy";
type BackgroundMode = "original";

const presets = [
  { label: "29 × 29", width: 29, height: 29 },
  { label: "58 × 58", width: 58, height: 58 },
  { label: "87 × 87", width: 87, height: 87 },
  { label: "116 × 116", width: 116, height: 116 },
];
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const linear = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toLab = ([r, g, b]: [number, number, number]) => {
  let x =
    (linear(r) * 0.4124 + linear(g) * 0.3576 + linear(b) * 0.1805) / 0.95047;
  let y = linear(r) * 0.2126 + linear(g) * 0.7152 + linear(b) * 0.0722;
  let z =
    (linear(r) * 0.0193 + linear(g) * 0.1192 + linear(b) * 0.9505) / 1.08883;
  const p = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  x = p(x);
  y = p(y);
  z = p(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
};
const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const readHistory = (): HistoryItem[] => {
  try {
    return JSON.parse(localStorage.getItem("bead-pattern-history-v4") || "[]");
  } catch {
    return [];
  }
};

export default function Home() {
  const [palette, setPalette] = useState<Color[]>([]);
  const [paletteStatus, setPaletteStatus] = useState("正在加载色卡");
  const [imageUrl, setImageUrl] = useState("");
  const [baseImageUrl, setBaseImageUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [cropUrl, setCropUrl] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [cropScale, setCropScale] = useState(1);
  const [cropRotation, setCropRotation] = useState(0);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [width, setWidth] = useState(58);
  const [height, setHeight] = useState(58);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("common48");
  const [styleMode, setStyleMode] = useState<StyleMode>("maker");
  const [friendliness, setFriendliness] = useState<Friendliness>("balanced");
  const [showCodes, setShowCodes] = useState(false);
  const [omitWhite, setOmitWhite] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [reduceNoise, setReduceNoise] = useState(true);
  const [dithering, setDithering] = useState(false);
  const [status, setStatus] = useState("上传图片后开始制作");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropViewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activePalette = useMemo(() => {
    if (paletteMode === "mard221" || palette.length <= 48) return palette;
    const count = paletteMode === "common36" ? 36 : 48;
    const result: Color[] = [];
    const step = (palette.length - 1) / (count - 1);
    for (let i = 0; i < count; i += 1)
      result.push(palette[Math.round(i * step)]);
    return result;
  }, [palette, paletteMode]);
  const activeLabs = useMemo(
    () => activePalette.map((color) => ({ ...color, lab: toLab(color.rgb) })),
    [activePalette],
  );

  useEffect(() => {
    setHistory(readHistory());
    fetch("/mard-221-colors.json")
      .then((r) => r.json())
      .then((data: { colors: Color[] }) => {
        const colors = data.colors.filter((color) => color.rgb?.length === 3);
        setPalette(colors);
        setPaletteStatus(`色卡已加载：${colors.length} 色`);
      })
      .catch(() => setPaletteStatus("色卡加载失败，请刷新页面"));
  }, []);
  useEffect(() => {
    if (pattern) drawPattern(pattern, showCodes, showGrid);
  }, [pattern, showCodes, showGrid]);

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !file.type.startsWith("image/"))
      return setStatus("请选择图片文件");
    if (cropUrl.startsWith("blob:")) URL.revokeObjectURL(cropUrl);
    const next = URL.createObjectURL(file);
    setImageName(file.name);
    setCropUrl(next);
    setCropScale(1);
    setCropRotation(0);
    setCropOffset({ x: 0, y: 0 });
    setCropOpen(true);
    setStatus("请拖动图片调整取景范围");
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: cropOffset.x,
      originY: cropOffset.y,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setCropOffset({
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y,
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const closeCrop = () => {
    setCropOpen(false);
    if (cropUrl.startsWith("blob:")) URL.revokeObjectURL(cropUrl);
  };
  const confirmCrop = () => {
    const source = new Image();
    source.onload = () => {
      const size = Math.min(source.naturalWidth, source.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const viewport = cropViewportRef.current;
      const fitScale = viewport
        ? Math.min(
            viewport.clientWidth / source.naturalWidth,
            viewport.clientHeight / source.naturalHeight,
          )
        : 1;
      const cropSize =
        (viewport ? viewport.clientWidth * 0.82 : size) /
        Math.max(fitScale * cropScale, 0.01);
      const centerX =
        source.naturalWidth / 2 -
        cropOffset.x / Math.max(fitScale * cropScale, 0.01);
      const centerY =
        source.naturalHeight / 2 -
        cropOffset.y / Math.max(fitScale * cropScale, 0.01);
      ctx.translate(size / 2, size / 2);
      ctx.rotate((cropRotation * Math.PI) / 180);
      ctx.drawImage(
        source,
        centerX - cropSize / 2,
        centerY - cropSize / 2,
        cropSize,
        cropSize,
        -size / 2,
        -size / 2,
        size,
        size,
      );
      const cropped = canvas.toDataURL("image/png");
      setBaseImageUrl(cropped);
      setImageUrl(cropped);
      setPattern(null);
      setCropOpen(false);
      if (cropUrl.startsWith("blob:")) URL.revokeObjectURL(cropUrl);
      setStatus("图片已裁剪，可以选择生成条件");
    };
    source.src = cropUrl;
  };
  const cleanCutoutBlob = async (blob: Blob, sourceUrl: string) => {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败"));
        image.src = src;
      });
    const source = await load(sourceUrl);
    const result = await load(URL.createObjectURL(blob));
    const canvas = document.createElement("canvas");
    canvas.width = result.naturalWidth;
    canvas.height = result.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return blob;
    ctx.drawImage(result, 0, 0);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = source.naturalWidth;
    sourceCanvas.height = source.naturalHeight;
    const sourceCtx = sourceCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!sourceCtx) return blob;
    sourceCtx.drawImage(source, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourcePixels = sourceCtx.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
    ).data;
    const sample: number[] = [];
    const corner = Math.max(
      2,
      Math.floor(Math.min(sourceCanvas.width, sourceCanvas.height) * 0.035),
    );
    for (const [x, y] of [
      [0, 0],
      [sourceCanvas.width - corner, 0],
      [0, sourceCanvas.height - corner],
      [sourceCanvas.width - corner, sourceCanvas.height - corner],
    ]) {
      for (let yy = y; yy < y + corner; yy += 1)
        for (let xx = x; xx < x + corner; xx += 1) {
          const i = (yy * sourceCanvas.width + xx) * 4;
          sample.push(
            sourcePixels[i],
            sourcePixels[i + 1],
            sourcePixels[i + 2],
          );
        }
    }
    const bg: [number, number, number] = [0, 1, 2].map(
      (channel) =>
        sample
          .filter((_, i) => i % 3 === channel)
          .reduce((sum, value) => sum + value, 0) /
        (sample.length / 3),
    ) as [number, number, number];
    const spread = Math.max(
      ...[0, 1, 2].map((channel) => {
        const values = sample.filter((_, i) => i % 3 === channel);
        return Math.max(...values) - Math.min(...values);
      }),
    );
    if (spread < 90 && bg[0] + bg[1] + bg[2] < 720) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const distance = Math.hypot(
          pixels.data[i] - bg[0],
          pixels.data[i + 1] - bg[1],
          pixels.data[i + 2] - bg[2],
        );
        if (distance < 80) pixels.data[i + 3] = 0;
        else if (distance < 120)
          pixels.data[i + 3] = Math.min(pixels.data[i + 3], 45);
      }
      ctx.putImageData(pixels, 0, 0);
    }
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((output) => resolve(output || blob), "image/png"),
    );
  };
  const keyOutFlatBackground = async (sourceUrl: string) => {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片加载失败"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法处理图片");
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const sample = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const corners = [
      sample(0, 0),
      sample(canvas.width - 1, 0),
      sample(0, canvas.height - 1),
      sample(canvas.width - 1, canvas.height - 1),
    ];
    const bg: [number, number, number] = [0, 1, 2].map(
      (channel) =>
        corners.reduce((sum, color) => sum + color[channel], 0) /
        corners.length,
    ) as [number, number, number];
    const distance = (index: number) =>
      Math.hypot(
        data[index] - bg[0],
        data[index + 1] - bg[1],
        data[index + 2] - bg[2],
      );
    const isBackgroundLike = (index: number) => {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      return distance(index) < 220 && b > r + 18 && b > g + 8;
    };
    const total = canvas.width * canvas.height;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const enqueue = (index: number) => {
      if (
        index < 0 ||
        index >= total ||
        visited[index] ||
        !isBackgroundLike(index * 4)
      )
        return;
      visited[index] = 1;
      queue[tail] = index;
      tail += 1;
    };
    for (let x = 0; x < canvas.width; x += 1) {
      enqueue(x);
      enqueue((canvas.height - 1) * canvas.width + x);
    }
    for (let y = 0; y < canvas.height; y += 1) {
      enqueue(y * canvas.width);
      enqueue(y * canvas.width + canvas.width - 1);
    }
    while (head < tail) {
      const index = queue[head];
      head += 1;
      data[index * 4 + 3] = 0;
      const x = index % canvas.width;
      const y = Math.floor(index / canvas.width);
      if (x > 0) enqueue(index - 1);
      if (x + 1 < canvas.width) enqueue(index + 1);
      if (y > 0) enqueue(index - canvas.width);
      if (y + 1 < canvas.height) enqueue(index + canvas.width);
    }
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (
        (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 240 &&
          b > r + 25 &&
          b > g + 12 &&
          b < 190) ||
        (r < 110 &&
          g < 110 &&
          b < 130 &&
          b > r + 8 &&
          !(r < 45 && g < 45 && b < 45))
      )
        data[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((output) => resolve(output || new Blob()), "image/png"),
    );
  };
  const hasFlatBackground = async (sourceUrl: string) => {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片加载失败"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const size = Math.max(
      2,
      Math.floor(Math.min(canvas.width, canvas.height) * 0.035),
    );
    const samples: number[] = [];
    for (const [x, y] of [
      [0, 0],
      [canvas.width - size, 0],
      [0, canvas.height - size],
      [canvas.width - size, canvas.height - size],
    ])
      for (let yy = y; yy < y + size; yy += 1)
        for (let xx = x; xx < x + size; xx += 1) {
          const i = (yy * canvas.width + xx) * 4;
          samples.push(pixels[i], pixels[i + 1], pixels[i + 2]);
        }
    const average = [0, 1, 2].map(
      (channel) =>
        samples
          .filter((_, i) => i % 3 === channel)
          .reduce((sum, value) => sum + value, 0) /
        (samples.length / 3),
    );
    const spread = Math.max(
      ...[0, 1, 2].map((channel) => {
        const values = samples.filter((_, i) => i % 3 === channel);
        return Math.max(...values) - Math.min(...values);
      }),
    );
    return spread < 90 && average[0] + average[1] + average[2] < 720;
  };
  const findColor = (
    rgb: [number, number, number],
    candidates: Array<Color & { lab: readonly [number, number, number] }>,
  ) => {
    const target = toLab(rgb);
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const current = distance(target, candidate.lab);
      if (current < bestDistance) {
        best = candidate;
        bestDistance = current;
      }
    }
    return best;
  };
  const generateWithOpenSource = async () => {
    if (!imageUrl) return setStatus("请先上传并裁剪图片");
    if (!activePalette.length) return setStatus("色卡还没有加载完成");
    setIsProcessing(true);
    setStatus("正在按拼豆格取样生成图纸");
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], imageName || "image.png", {
        type: blob.type || "image/png",
      });
      const w = clamp(Math.round(width), 8, 160);
      const sourcePalette = activePalette.map((color) => ({
        id: `local-${color.code}`,
        primaryBrand: "MARD" as const,
        primaryCode: color.code,
        hex: color.hex,
        rgb: color.rgb,
        codes: { MARD: color.code },
        group: "local",
        name: color.code,
      }));
      const result = await imageFileToBeads(file, {
        width: w,
        maxColors:
          friendliness === "easy"
            ? Math.min(36, sourcePalette.length)
            : sourcePalette.length,
        palette: sourcePalette,
        backgroundMode: "keep",
        backgroundColor: [255, 255, 255],
        tolerance: 48,
        speckleReduction: reduceNoise ? (friendliness === "easy" ? 4 : 3) : 0,
        generationStyle: styleMode === "photo" ? "realistic" : "cartoon",
      });
      const byId = new Map(
        sourcePalette.map((color, index) => [color.id, activePalette[index]]),
      );
      const white =
        palette.find((color) => color.code === "H2") ||
        palette.find((color) => color.code === "T1") ||
        activePalette[0];
      const cells = result.cells.map((id) =>
        id ? byId.get(id) || white : white,
      );
      const counts = new Map<string, Color & { count: number }>();
      cells.forEach((cell) => {
        const item = counts.get(cell.code);
        if (item) item.count += 1;
        else counts.set(cell.code, { ...cell, count: 1 });
      });
      const next = {
        width: result.width,
        height: result.height,
        cells,
        usage: Array.from(counts.values()).sort((a, b) => b.count - a.count),
      };
      setWidth(result.width);
      setHeight(result.height);
      setPattern(next);
      setStatus(
        `已生成 ${result.width} × ${result.height} 图纸，共 ${next.usage.length} 个色号`,
      );
      window.setTimeout(() => saveHistory(next), 50);
    } catch (error) {
      console.error("开源算法生成失败", error);
      setStatus("生成失败，请重新上传图片后再试");
    } finally {
      setIsProcessing(false);
    }
  };

  const generate = async () => {
    if (!imageUrl) return setStatus("请先上传并裁剪图片");
    if (!activeLabs.length) return setStatus("色卡还没有加载完成");
    const source = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve();
        source.onerror = () => reject(new Error("图片加载失败"));
        source.src = imageUrl;
      });
    } catch {
      setStatus("图片还没有准备好，请稍后再试");
      return;
    }
    const w = clamp(Math.round(width), 8, 160);
    const h = clamp(Math.round(height), 8, 160);
    const sample = document.createElement("canvas");
    sample.width = w;
    sample.height = h;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const limit = friendliness === "easy" ? 48 : activeLabs.length;
    const candidates = activeLabs.slice(0, limit);
    const black = palette.find((color) => color.code === "H7");
    if (black && !candidates.some((color) => color.code === black.code))
      candidates.push(black);
    const errors = new Array(w * h * 3).fill(0);
    let cells: Color[] = [];
    const counts = new Map<string, Color & { count: number }>();
    const useDither = dithering && friendliness !== "easy";
    for (let i = 0; i < pixels.length; i += 4) {
      const index = i / 4;
      const x = index % w;
      const y = Math.floor(index / w);
      const base: [number, number, number] =
        pixels[i + 3] < 12
          ? [255, 255, 255]
          : [pixels[i], pixels[i + 1], pixels[i + 2]];
      const rgb: [number, number, number] = [
        clamp(base[0] + (useDither ? errors[index * 3] : 0), 0, 255),
        clamp(base[1] + (useDither ? errors[index * 3 + 1] : 0), 0, 255),
        clamp(base[2] + (useDither ? errors[index * 3 + 2] : 0), 0, 255),
      ];
      const outline =
        base[0] < 90 &&
        base[1] < 90 &&
        base[2] < 90 &&
        Math.max(...base) - Math.min(...base) < 42;
      const nearest = outline
        ? black || findColor(rgb, candidates)
        : findColor(rgb, candidates);
      cells.push({ code: nearest.code, hex: nearest.hex, rgb: nearest.rgb });
      const item = counts.get(nearest.code);
      if (item) item.count += 1;
      else counts.set(nearest.code, { ...nearest, count: 1 });
      if (useDither) {
        const error = [
          rgb[0] - nearest.rgb[0],
          rgb[1] - nearest.rgb[1],
          rgb[2] - nearest.rgb[2],
        ];
        const spread = (nx: number, ny: number, weight: number) => {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
          const target = (ny * w + nx) * 3;
          errors[target] += error[0] * weight;
          errors[target + 1] += error[1] * weight;
          errors[target + 2] += error[2] * weight;
        };
        spread(x + 1, y, 7 / 16);
        spread(x - 1, y + 1, 3 / 16);
        spread(x, y + 1, 5 / 16);
        spread(x + 1, y + 1, 1 / 16);
      }
    }
    if (reduceNoise) {
      for (let pass = 0; pass < 3; pass += 1) {
        const current = cells.slice();
        cells = current.map((cell, index) => {
          const x = index % w;
          const y = Math.floor(index / w);
          const neighbors = new Map<string, { color: Color; count: number }>();
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const candidate = current[ny * w + nx];
              const item = neighbors.get(candidate.code);
              if (item) item.count += 1;
              else
                neighbors.set(candidate.code, { color: candidate, count: 1 });
            }
          }
          const dominant = Array.from(neighbors.values()).sort(
            (a, b) => b.count - a.count,
          )[0];
          return dominant &&
            dominant.count >= 5 &&
            (neighbors.get(cell.code)?.count || 0) <= 4 &&
            cell.rgb[0] + cell.rgb[1] + cell.rgb[2] > 135
            ? { ...dominant.color }
            : cell;
        });
      }
      counts.clear();
      cells.forEach((cell) => {
        const item = counts.get(cell.code);
        if (item) item.count += 1;
        else counts.set(cell.code, { ...cell, count: 1 });
      });
    }
    const next = {
      width: w,
      height: h,
      cells,
      usage: Array.from(counts.values()).sort((a, b) => b.count - a.count),
    };
    setWidth(w);
    setHeight(h);
    setPattern(next);
    setStatus(`已生成 ${w} × ${h} 图纸，共 ${next.usage.length} 个色号`);
    window.setTimeout(() => saveHistory(next), 50);
  };
  const drawPattern = (current: Pattern, codes: boolean, grid: boolean) => {
    const canvas = patternCanvasRef.current;
    if (!canvas) return;
    const size =
      current.width > 116
        ? 22
        : current.width > 88
          ? 26
          : current.width > 58
            ? 32
            : 42;
    canvas.width = current.width * size;
    canvas.height = current.height * size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(9, Math.floor(size * 0.34))}px Arial`;
    current.cells.forEach((cell, index) => {
      const x = (index % current.width) * size;
      const y = Math.floor(index / current.width) * size;
      ctx.fillStyle = cell.hex;
      ctx.fillRect(x, y, size, size);
      if (grid) {
        ctx.strokeStyle = "rgba(31,41,55,.2)";
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
      if (codes) {
        const light =
          cell.rgb[0] * 0.299 + cell.rgb[1] * 0.587 + cell.rgb[2] * 0.114;
        ctx.fillStyle = light > 150 ? "#202020" : "#fff";
        ctx.fillText(cell.code, x + size / 2, y + size / 2);
      }
    });
  };
  const saveHistory = (current: Pattern) => {
    const canvas = document.createElement("canvas");
    const size = current.width > 116 ? 10 : 14;
    canvas.width = current.width * size;
    canvas.height = current.height * size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    current.cells.forEach((cell, index) => {
      ctx.fillStyle = cell.hex;
      ctx.fillRect(
        (index % current.width) * size,
        Math.floor(index / current.width) * size,
        size,
        size,
      );
    });
    const item: HistoryItem = {
      ...current,
      id: crypto.randomUUID(),
      sourceName: imageName,
      paletteMode,
      styleMode,
      friendliness,
      preview: canvas.toDataURL("image/png"),
    };
    const next = [
      item,
      ...readHistory().filter(
        (entry) =>
          entry.sourceName !== item.sourceName ||
          entry.width !== item.width ||
          entry.height !== item.height,
      ),
    ].slice(0, 12);
    setHistory(next);
    localStorage.setItem("bead-pattern-history-v4", JSON.stringify(next));
  };
  const openHistory = (item: HistoryItem) => {
    setPattern(item);
    setWidth(item.width);
    setHeight(item.height);
    setPaletteMode(item.paletteMode);
    setStyleMode(item.styleMode);
    setFriendliness(item.friendliness);
    setStatus(`已打开 ${item.sourceName || "历史图纸"}`);
  };
  const removeHistory = (id: string) => {
    const next = history.filter((item) => item.id !== id);
    setHistory(next);
    localStorage.setItem("bead-pattern-history-v4", JSON.stringify(next));
  };
  const download = (codes: boolean) => {
    if (!pattern || !patternCanvasRef.current) return setStatus("请先生成图纸");
    drawPattern(pattern, codes, true);
    const link = document.createElement("a");
    link.download = `拼豆图纸-${pattern.width}x${pattern.height}${codes ? "-带色号" : ""}.png`;
    link.href = patternCanvasRef.current.toDataURL("image/png");
    link.click();
    drawPattern(pattern, showCodes, showGrid);
    setStatus("图片已下载，请在设备中保存到相册");
  };
  const downloadUsage = () => {
    if (!pattern) return setStatus("请先生成图纸");
    const lines = [
      "色号,颜色,数量,建议购买数量",
      ...pattern.usage.map(
        (item) =>
          `${item.code},${item.hex},${item.count},${Math.ceil(item.count * 1.08)}`,
      ),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.download = `拼豆颜色清单-${pattern.width}x${pattern.height}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="min-h-screen bg-[#f6f2e9] text-[#1f2933]">
      <header className="border-b border-[#dcd3c5] bg-[#fffdf8]">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-7">
          <p className="text-sm font-semibold tracking-wide text-[#315c58]">
            图片转拼豆图纸 · 第五版
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            上传图片，裁剪后生成拼豆图纸
          </h1>
          <p className="mt-2 text-sm text-[#65706c]">
            拖动图片取景，生成完整图纸，保存到手机或平板。
          </p>
        </div>
      </header>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-7 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-[#dcd3c5] bg-[#fffdf8] p-4 shadow-sm">
          <h2 className="text-lg font-semibold">1. 准备图片</h2>
          <div className="upload-zone mt-4 rounded-md border border-dashed border-[#aebdb0] bg-[#f5faf2] p-5 text-center">
            <button
              type="button"
              className="upload-button"
              onClick={() => fileInputRef.current?.click()}
            >
              上传图片
            </button>
            <span className="mt-1 block text-xs text-[#65706c]">
              选择后会自动打开裁剪
            </span>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleUpload}
            />
          </div>
          {imageUrl ? (
            <div className="mt-4">
              <p className="setting-label">待制作图片</p>
              <img
                ref={imageRef}
                src={imageUrl}
                alt={imageName || "裁剪后的图片"}
                className="mt-2 aspect-square w-full rounded-md border border-[#ded6c8] bg-[#f9f5ec] object-contain"
                onLoad={() => setStatus("图片已准备好，可以生成")}
              />
              <button
                type="button"
                className="secondary-button mt-2 w-full"
                onClick={() => {
                  setCropUrl(baseImageUrl || imageUrl);
                  setCropScale(1);
                  setCropOffset({ x: 0, y: 0 });
                  setCropOpen(true);
                }}
              >
                重新裁剪
              </button>
            </div>
          ) : (
            <div className="mt-4 flex aspect-square items-center justify-center rounded-md border border-[#ded6c8] bg-[#f9f5ec] text-sm text-[#6f6254]">
              待制作图片
            </div>
          )}
          <h2 className="mt-6 text-lg font-semibold">2. 生成条件</h2>
          <p className="setting-label mt-4">图纸大小</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`setting-button ${width === preset.width && height === preset.height ? "selected" : ""}`}
                onClick={() => {
                  setWidth(preset.width);
                  setHeight(preset.height);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label>
              <span className="setting-label">宽</span>
              <input
                className="number-input"
                type="number"
                min={8}
                max={160}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label>
              <span className="setting-label">高</span>
              <input
                className="number-input"
                type="number"
                min={8}
                max={160}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="setting-label">色板</span>
            <select
              className="select-input"
              value={paletteMode}
              onChange={(e) => setPaletteMode(e.target.value as PaletteMode)}
            >
              <option value="common36">常用 36 色</option>
              <option value="common48">常用 48 色</option>
              <option value="mard221">MARD 221 色</option>
            </select>
          </label>
          <label className="mt-3 block">
            <span className="setting-label">转换效果</span>
            <select
              className="select-input"
              value={styleMode}
              onChange={(e) => setStyleMode(e.target.value as StyleMode)}
            >
              <option value="maker">适合制作</option>
              <option value="cartoon">卡通效果</option>
              <option value="photo">还原照片</option>
            </select>
          </label>
          <div className="mt-3">
            <p className="setting-label">拼豆友好度</p>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {(
                [
                  ["detail", "细节优先"],
                  ["balanced", "平衡"],
                  ["easy", "易制作"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`small-choice ${friendliness === value ? "selected" : ""}`}
                  onClick={() => setFriendliness(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={reduceNoise}
                onChange={(e) => setReduceNoise(e.target.checked)}
              />
              合并孤立杂色
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={dithering}
                onChange={(e) => setDithering(e.target.checked)}
              />
              抖动处理
            </label>
            <label className="toggle-row sm:col-span-2">
              <input
                type="checkbox"
                checked={omitWhite}
                onChange={(e) => setOmitWhite(e.target.checked)}
              />
              白色背景不标注 H2
            </label>
          </div>
          <button
            type="button"
            className="primary-button mt-5 w-full"
            onClick={generateWithOpenSource}
          >
            生成图纸
          </button>
          <p className="mt-3 text-sm text-[#65706c]">{status}</p>
          <p className="mt-2 text-xs text-[#8a8377]">{paletteStatus}</p>
        </aside>
        <section className="rounded-lg border border-[#dcd3c5] bg-[#fffdf8] p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5ded2] px-1 pb-3">
            <div>
              <h2 className="text-lg font-semibold">3. 图纸结果</h2>
              <p className="text-sm text-[#65706c]">
                生成后默认完整展示整张图纸。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="tool-button"
                onClick={() => setShowGrid(!showGrid)}
              >
                {showGrid ? "隐藏网格" : "显示网格"}
              </button>
              <button
                type="button"
                className="tool-button"
                onClick={() => setShowCodes(!showCodes)}
              >
                {showCodes ? "隐藏色号" : "显示色号"}
              </button>
            </div>
          </div>
          <div className="pattern-stage mt-3">
            {pattern ? (
              <canvas
                ref={patternCanvasRef}
                className="pattern-canvas"
                aria-label="完整拼豆图纸"
              />
            ) : (
              <div className="text-center text-[#6f6254]">
                <p className="font-semibold">等待生成图纸</p>
                <p className="mt-2 text-sm">完成左侧设置后点击“生成图纸”。</p>
              </div>
            )}
          </div>
          {pattern && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => download(false)}
                >
                  保存图纸
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => download(true)}
                >
                  保存带色号图纸
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={downloadUsage}
                >
                  保存颜色清单
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="stat-box">
                  <span>拼豆总数</span>
                  <strong>{pattern.width * pattern.height}</strong>
                </div>
                <div className="stat-box">
                  <span>颜色数量</span>
                  <strong>{pattern.usage.length}</strong>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
      {history.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-7">
          <div className="border-t border-[#dcd3c5] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">历史记录</h2>
                <p className="mt-1 text-sm text-[#65706c]">
                  保存在本设备中，点击作品可重新打开。
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-[#65706c]"
                onClick={() => {
                  localStorage.removeItem("bead-pattern-history-v4");
                  setHistory([]);
                }}
              >
                清空全部
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((item) => (
                <article key={item.id} className="history-card">
                  <img src={item.preview} alt="历史图纸缩略图" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">
                      {item.sourceName || "未命名图片"}
                    </h3>
                    <p className="mt-1 text-xs text-[#65706c]">
                      {item.width} × {item.height} ·{" "}
                      {item.paletteMode === "mard221"
                        ? "MARD 221 色"
                        : item.paletteMode === "common48"
                          ? "常用 48 色"
                          : "常用 36 色"}
                    </p>
                    <p className="mt-1 text-xs text-[#65706c]">
                      {item.styleMode === "maker"
                        ? "适合制作"
                        : item.styleMode === "cartoon"
                          ? "卡通效果"
                          : "还原照片"}{" "}
                      ·{" "}
                      {item.friendliness === "easy"
                        ? "易制作"
                        : item.friendliness === "detail"
                          ? "细节优先"
                          : "平衡"}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="secondary-button flex-1"
                        onClick={() => openHistory(item)}
                      >
                        重新打开
                      </button>
                      <button
                        type="button"
                        className="delete-button"
                        onClick={() => removeHistory(item.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
      {cropOpen && (
        <div
          className="crop-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="裁剪图片"
        >
          <div className="crop-dialog">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">裁剪图片</h2>
                <p className="mt-1 text-sm text-[#65706c]">
                  拖动图片调整取景范围，可缩放和旋转。
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="关闭裁剪"
                onClick={closeCrop}
              >
                ×
              </button>
            </div>
            <div
              ref={cropViewportRef}
              className="crop-viewport"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={endDrag}
            >
              <img
                ref={cropImageRef}
                src={cropUrl}
                alt="待裁剪图片"
                draggable={false}
                style={{
                  transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropScale}) rotate(${cropRotation}deg)`,
                }}
              />
            </div>
            <div className="crop-controls">
              <label>
                <span>缩放</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step=".01"
                  value={cropScale}
                  onChange={(event) => setCropScale(Number(event.target.value))}
                />
              </label>
              <label>
                <span>旋转</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={cropRotation}
                  onChange={(event) =>
                    setCropRotation(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={closeCrop}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={confirmCrop}
              >
                使用这张图片
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
