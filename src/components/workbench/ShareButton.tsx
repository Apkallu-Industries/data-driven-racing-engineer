import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Share2, Check, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createShareLink, revokeShareLink } from "@/server/share.functions";
import { useWorkbench } from "@/lib/store";

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Never", days: null },
];

export function ShareButton({ sessionId }: { sessionId: string }) {
  const { refLap, cmpLap } = useWorkbench();
  const create = useServerFn(createShareLink);
  const revoke = useServerFn(revokeShareLink);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState<number | null>(7);

  const handle = async () => {
    setBusy(true);
    try {
      const { token } = await create({
        data: {
          sessionId,
          refLap: refLap ?? null,
          cmpLap: cmpLap ?? null,
          expiresInDays: expiryDays,
        },
      });
      const u = `${window.location.origin}/share/${token}`;
      setUrl(u);
      setToken(token);
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

  const handleRevoke = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await revoke({ data: { token } });
      setUrl(null);
      setToken(null);
      toast.success("Link revoked. Anyone with the URL will get a 404.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={expiryDays ?? ""}
        onChange={(e) => setExpiryDays(e.target.value === "" ? null : parseInt(e.target.value, 10))}
        className="h-6 rounded-sm border border-border bg-rail px-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        title="Link expiration"
      >
        {EXPIRY_OPTIONS.map((o) => (
          <option key={o.label} value={o.days ?? ""}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        onClick={handle}
        disabled={busy}
        className="flex h-6 items-center gap-1 rounded-sm border border-border bg-rail px-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Create a public read-only link to this lap"
      >
        <Share2 className="h-3 w-3" /> {busy ? "…" : "Share"}
      </button>
      {url && (
        <>
          <button
            onClick={copyAgain}
            className="flex h-6 items-center gap-1 rounded-sm border border-border bg-panel px-2 font-mono text-[10px] text-foreground hover:bg-accent"
            title={url}
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            <span className="max-w-[180px] truncate">{url.replace(/^https?:\/\//, "")}</span>
          </button>
          <button
            onClick={handleRevoke}
            disabled={busy}
            className="flex h-6 items-center gap-1 rounded-sm border border-destructive/50 bg-rail px-2 font-mono text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10 disabled:opacity-50"
            title="Revoke this link — copies of the URL will stop working immediately"
          >
            <Trash2 className="h-3 w-3" /> Revoke
          </button>
        </>
      )}
    </div>
  );
}