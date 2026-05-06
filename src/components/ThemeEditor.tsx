import { useEffect, useRef, useState } from "react";
import { Palette, RotateCcw, Upload, Download, Share2, Loader2 } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/lib/themeContext";
import { DARK_THEME, PRESETS, THEME_GROUPS, type ThemeMap, type ThemeTokenKey } from "@/lib/theme";
import { ThemeCard, type ThemeCardData } from "@/components/ThemeCard";
import { useAuth } from "@/lib/auth";
import {
  listSharedThemes,
  publishTheme,
  deleteSharedTheme,
} from "@/server/themes.functions";
import { toast } from "sonner";

export function ThemeEditor() {
  const { theme, setToken, setTheme, reset } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("editor");
  const [gallery, setGallery] = useState<
    { id: string; user_id: string; name: string; description: string | null; theme: ThemeMap }[]
  >([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [shareName, setShareName] = useState("");
  const [shareDesc, setShareDesc] = useState("");
  const [publishing, setPublishing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const value = (k: ThemeTokenKey) => (theme[k] ?? DARK_THEME[k]) as string;

  const loadGallery = async () => {
    setLoadingGallery(true);
    try {
      const res = await listSharedThemes();
      setGallery(
        (res.themes ?? []).map((t: any) => ({
          ...t,
          theme: t.theme as ThemeMap,
        })),
      );
    } catch {
      toast.error("Failed to load themes");
    } finally {
      setLoadingGallery(false);
    }
  };

  useEffect(() => {
    if (open && tab === "gallery") loadGallery();
  }, [open, tab]);

  const exportTheme = () => {
    const merged: ThemeMap = { ...DARK_THEME, ...theme };
    const payload = {
      $schema: "apextrace.theme/v1",
      name: shareName || "My Theme",
      theme: merged,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(shareName || "apextrace-theme").replace(/\s+/g, "-").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importTheme = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = (parsed?.theme ?? parsed) as Record<string, unknown>;
      if (!incoming || typeof incoming !== "object") throw new Error("Invalid theme");
      const cleaned: ThemeMap = {};
      for (const k of Object.keys(DARK_THEME)) {
        const v = (incoming as Record<string, unknown>)[k];
        if (typeof v === "string") (cleaned as Record<string, string>)[k] = v;
      }
      if (Object.keys(cleaned).length === 0) throw new Error("No matching tokens");
      setTheme({ ...DARK_THEME, ...cleaned });
      if (typeof parsed?.name === "string") setShareName(parsed.name);
      toast.success("Theme imported");
    } catch (e) {
      toast.error("Could not import theme");
    }
  };

  const handlePublish = async () => {
    if (!user) {
      toast.error("Sign in to share a theme");
      return;
    }
    if (!shareName.trim()) {
      toast.error("Give your theme a name");
      return;
    }
    setPublishing(true);
    try {
      const merged = { ...DARK_THEME, ...theme } as Record<string, string>;
      const res = await publishTheme({
        data: {
          name: shareName.trim(),
          description: shareDesc.trim() || null,
          theme: merged,
        },
      });
      if (!res.ok) throw new Error(res.error);
      toast.success("Theme published");
      setShareDesc("");
      if (tab === "gallery") loadGallery();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await deleteSharedTheme({ data: { id } });
      if (!res.ok) throw new Error(res.error);
      setGallery((g) => g.filter((t) => t.id !== id));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

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
      <SheetContent side="right" className="w-[380px] sm:w-[440px] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="font-mono text-sm tracking-wider">THEME EDITOR</SheetTitle>
          <SheetDescription className="text-xs">
            Tune colors, import/export JSON, or share your theme with others.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 grid grid-cols-3">
            <TabsTrigger value="editor" className="text-xs">Editor</TabsTrigger>
            <TabsTrigger value="share" className="text-xs">Share</TabsTrigger>
            <TabsTrigger value="gallery" className="text-xs">Gallery</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="mt-0 flex flex-1 flex-col overflow-hidden">
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
          </TabsContent>

          <TabsContent value="share" className="mt-0 flex flex-1 flex-col overflow-hidden">
            <ScrollArea className="flex-1 px-4 pt-3">
              <div className="space-y-4 pb-6">
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Import / Export
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> Import JSON
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={exportTheme}>
                      <Download className="h-3.5 w-3.5" /> Export JSON
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importTheme(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Publish to gallery
                  </div>
                  <div className="space-y-2">
                    <Input
                      placeholder="Theme name"
                      value={shareName}
                      onChange={(e) => setShareName(e.target.value)}
                      className="h-8 text-xs"
                      maxLength={60}
                    />
                    <Textarea
                      placeholder="Short description (optional)"
                      value={shareDesc}
                      onChange={(e) => setShareDesc(e.target.value)}
                      className="min-h-16 text-xs"
                      maxLength={280}
                    />
                    <Button size="sm" onClick={handlePublish} disabled={publishing} className="w-full gap-1.5">
                      {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                      Publish current theme
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Preview card
                  </div>
                  <ThemeCard
                    card={{
                      name: shareName || "My Theme",
                      description: shareDesc || null,
                      theme: { ...DARK_THEME, ...theme },
                    }}
                    onApply={() => toast.message("That's already your current theme")}
                  />
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="gallery" className="mt-0 flex flex-1 flex-col overflow-hidden">
            <ScrollArea className="flex-1 px-4 pt-3">
              <div className="grid grid-cols-2 gap-2 pb-6">
                {loadingGallery && (
                  <div className="col-span-2 flex items-center justify-center py-8 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                  </div>
                )}
                {!loadingGallery && gallery.length === 0 && (
                  <div className="col-span-2 py-8 text-center text-xs text-muted-foreground">
                    No shared themes yet. Be the first to publish one.
                  </div>
                )}
                {gallery.map((t) => {
                  const card: ThemeCardData = {
                    id: t.id,
                    name: t.name,
                    description: t.description,
                    theme: t.theme,
                  };
                  return (
                    <ThemeCard
                      key={t.id}
                      card={card}
                      onApply={(th) => {
                        setTheme({ ...DARK_THEME, ...th });
                        toast.success(`Installed "${t.name}"`);
                      }}
                      onDelete={user?.id === t.user_id ? () => handleDelete(t.id) : undefined}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

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