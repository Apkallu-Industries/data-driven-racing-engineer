/** Utilities for exporting SVG/Canvas panels as PNG/SVG files. */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Inline computed CSS variable values into the SVG so PNG/SVG render standalone. */
function inlineCssVars(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Resolve var(--x) tokens from computed style of the *original* svg.
  const computed = getComputedStyle(svg);
  const all = clone.querySelectorAll<SVGElement>("*");
  const fixAttr = (el: Element, attr: string) => {
    const v = el.getAttribute(attr);
    if (!v || !v.includes("var(")) return;
    const m = v.match(/var\((--[a-zA-Z0-9-]+)\)/);
    if (!m) return;
    const resolved = computed.getPropertyValue(m[1]).trim();
    if (resolved) el.setAttribute(attr, v.replace(m[0], resolved));
  };
  // Background
  const bg = computed.getPropertyValue("--background").trim() || "#1a1d21";
  clone.setAttribute("style", `background:${bg}`);
  for (const el of [clone, ...Array.from(all)]) {
    fixAttr(el, "fill");
    fixAttr(el, "stroke");
  }
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvgAsSvg(svg: SVGSVGElement, filename: string) {
  const xml = inlineCssVars(svg);
  downloadBlob(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function exportSvgAsPng(svg: SVGSVGElement, filename: string, scale = 2) {
  const xml = inlineCssVars(svg);
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth || 800;
  const h = vb && vb.height ? vb.height : svg.clientHeight || 600;
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d")!;
    const bg = getComputedStyle(svg).getPropertyValue("--background").trim() || "#1a1d21";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve) =>
      canvas.toBlob((b) => {
        if (b) downloadBlob(b, filename);
        resolve();
      }, "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((b) => {
    if (b) downloadBlob(b, filename);
  }, "image/png");
}

/** Combine multiple side-by-side SVGs into one composite PNG. */
export async function exportSvgGroupAsPng(
  svgs: SVGSVGElement[],
  filename: string,
  scale = 2,
  gap = 16,
) {
  if (svgs.length === 0) return;
  const items = svgs.map((s) => {
    const vb = s.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : s.clientWidth || 300;
    const h = vb && vb.height ? vb.height : s.clientHeight || 300;
    return { svg: s, w, h, xml: inlineCssVars(s) };
  });
  const totalW = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1);
  const maxH = items.reduce((a, it) => Math.max(a, it.h), 0);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(totalW * scale);
  canvas.height = Math.round(maxH * scale);
  const ctx = canvas.getContext("2d")!;
  const bg = getComputedStyle(svgs[0]).getPropertyValue("--background").trim() || "#1a1d21";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let xCursor = 0;
  for (const it of items) {
    const blob = new Blob([it.xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg load failed"));
        img.src = url;
      });
      ctx.drawImage(img, xCursor * scale, 0, it.w * scale, it.h * scale);
    } finally {
      URL.revokeObjectURL(url);
    }
    xCursor += it.w + gap;
  }
  await new Promise<void>((resolve) =>
    canvas.toBlob((b) => {
      if (b) downloadBlob(b, filename);
      resolve();
    }, "image/png"),
  );
}