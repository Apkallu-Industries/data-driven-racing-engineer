import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThemeMap } from "@/lib/theme";
import { DARK_THEME } from "@/lib/theme";

const SWATCH_KEYS: { key: keyof typeof DARK_THEME; label: string }[] = [
  { key: "background", label: "BG" },
  { key: "panel", label: "Pn" },
  { key: "primary", label: "Pr" },
  { key: "foreground", label: "Fg" },
  { key: "ch-speed", label: "Sp" },
  { key: "ch-throttle", label: "Th" },
  { key: "ch-brake", label: "Br" },
  { key: "ch-rpm", label: "Rp" },
];

export interface ThemeCardData {
  id?: string;
  name: string;
  description?: string | null;
  theme: ThemeMap;
  isOwner?: boolean;
}

export function ThemeCard({
  card,
  onApply,
  onDelete,
}: {
  card: ThemeCardData;
  onApply: (theme: ThemeMap) => void;
  onDelete?: () => void;
}) {
  const get = (k: keyof typeof DARK_THEME) => (card.theme[k] ?? DARK_THEME[k]) as string;
  return (
    <div
      className="rounded-sm border border-border p-2"
      style={{ background: get("panel"), color: get("foreground") }}
    >
      <div
        className="mb-2 rounded-sm p-2"
        style={{ background: get("background"), border: `1px solid ${get("border")}` }}
      >
        <div className="mb-1.5 text-[11px] font-medium truncate">{card.name}</div>
        {card.description && (
          <div className="mb-2 text-[10px] opacity-70 line-clamp-2" style={{ color: get("muted-foreground") }}>
            {card.description}
          </div>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {SWATCH_KEYS.map((s) => (
            <div
              key={s.key}
              title={`${s.label} ${get(s.key)}`}
              className="aspect-square rounded-[2px] border"
              style={{ background: get(s.key), borderColor: get("border") }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-6 flex-1 gap-1 text-[10px]"
          onClick={() => onApply(card.theme)}
        >
          <Download className="h-3 w-3" />
          Install
        </Button>
        {onDelete && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-1.5"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}