import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Share2, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { createShareLink } from "@/server/share.functions";
import { useWorkbench } from "@/lib/store";

export function ShareButton({ sessionId }: { sessionId: string }) {
  const { refLap, cmpLap } = useWorkbench();
  const create = useServerFn(createShareLink);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      const { token } = await create({
        data: { sessionId, refLap: refLap ?? null, cmpLap: cmpLap ?? null },
      });
      const u = `${window.location.origin}/share/${token}`;
      setUrl(u);
      try {
        await navigator.clipboard.writeText(u);
        setCopied(true);
        toast.success("Share link copied");
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.success("Share link created");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyAgain = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handle}
        disabled={busy}
        className="flex h-6 items-center gap-1 rounded-sm border border-border bg-rail px-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Create a public read-only link to this lap"
      >
        <Share2 className="h-3 w-3" /> {busy ? "…" : "Share"}
      </button>
      {url && (
        <button
          onClick={copyAgain}
          className="flex h-6 items-center gap-1 rounded-sm border border-border bg-panel px-2 font-mono text-[10px] text-foreground hover:bg-accent"
          title={url}
        >
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          <span className="max-w-[180px] truncate">{url.replace(/^https?:\/\//, "")}</span>
        </button>
      )}
    </div>
  );
}