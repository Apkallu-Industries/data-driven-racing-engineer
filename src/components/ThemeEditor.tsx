import { useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/themeContext";
import { DARK_THEME, PRESETS, THEME_GROUPS, type ThemeTokenKey } from "@/lib/theme";

export function ThemeEditor() {
  const { theme, setToken, setTheme, reset } = useTheme();
  const [open, setOpen] = useState(false);

  const value = (k: ThemeTokenKey) => (theme[k] ?? DARK_THEME[k]) as string;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-accent hover:text-foreground"
          title="Customize theme"
        >
          <Palette className="h-3.5 w-3.5" />
          Theme
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="font-mono text-sm tracking-wider">THEME EDITOR</SheetTitle>
          <SheetDescription className="text-xs">
            Pick a preset or tune any color. Changes save automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Presets
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setTheme(p.theme)}
                className="flex items-center gap-2 rounded-sm border border-border bg-panel-2 px-2 py-1.5 text-left text-xs hover:border-primary"
              >
                <span className="flex h-4 w-4 overflow-hidden rounded-sm border border-border">
                  <span className="flex-1" style={{ background: p.theme.background }} />
                  <span className="flex-1" style={{ background: p.theme.primary }} />
                </span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="mt-2 flex-1 px-4">
          <div className="space-y-4 pb-6">
            {THEME_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.tokens.map((t) => (
                    <label
                      key={t.key}
                      className="flex items-center justify-between gap-2 rounded-sm px-1 py-1 text-xs hover:bg-accent/40"
                    >
                      <span>{t.label}</span>
                      <span className="flex items-center gap-2">
                        <input
                          type="color"
                          value={value(t.key)}
                          onChange={(e) => setToken(t.key, e.target.value)}
                          className="h-6 w-8 cursor-pointer rounded-sm border border-border bg-transparent"
                        />
                        <input
                          type="text"
                          value={value(t.key)}
                          onChange={(e) => setToken(t.key, e.target.value)}
                          className="w-20 rounded-sm border border-border bg-panel-2 px-1.5 py-0.5 font-mono text-[10px]"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="hairline-t flex items-center justify-between gap-2 px-4 py-3">
          <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}