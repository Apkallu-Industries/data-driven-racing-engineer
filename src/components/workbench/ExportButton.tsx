import { Download } from "lucide-react";
import { useState } from "react";
import { exportSvgAsPng, exportSvgAsSvg, exportCanvasAsPng } from "@/lib/exportView";

interface Props {
  /** Returns the SVG element to export. */
  getSvg?: () => SVGSVGElement | null;
  /** Returns the canvas element to export (PNG only). */
  getCanvas?: () => HTMLCanvasElement | null;
  filenameBase: string;
  /** Show SVG download button (only meaningful for SVG sources). */
  allowSvg?: boolean;
}

export function ExportButton({ getSvg, getCanvas, filenameBase, allowSvg = true }: Props) {
  const [open, setOpen] = useState(false);

  const handlePng = async () => {
    setOpen(false);
    if (getSvg) {
      const el = getSvg();
      if (el) await exportSvgAsPng(el, `${filenameBase}.png`);
    } else if (getCanvas) {
      const el = getCanvas();
      if (el) exportCanvasAsPng(el, `${filenameBase}.png`);
    }
  };
  const handleSvg = () => {
    setOpen(false);
    if (!getSvg) return;
    const el = getSvg();
    if (el) exportSvgAsSvg(el, `${filenameBase}.svg`);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-5 items-center gap-1 rounded-sm border border-border bg-rail px-1.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
        title="Export view"
      >
        <Download className="h-3 w-3" /> Export
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 flex flex-col rounded-sm border border-border bg-panel py-1 shadow-lg">
          <button
            onClick={handlePng}
            className="px-3 py-1 text-left font-mono text-[11px] hover:bg-accent"
          >
            PNG
          </button>
          {allowSvg && getSvg && (
            <button
              onClick={handleSvg}
              className="px-3 py-1 text-left font-mono text-[11px] hover:bg-accent"
            >
              SVG
            </button>
          )}
        </div>
      )}
    </div>
  );
}