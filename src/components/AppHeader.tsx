import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="hairline-b flex h-12 items-center bg-panel px-4">
      <Link to="/sessions" className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <span className="font-mono text-xs tracking-wider">APEXTRACE</span>
      </Link>
      <div className="mx-4 h-4 w-px bg-border" />
      <div className="flex flex-1 items-center gap-3 text-xs text-muted-foreground">{children}</div>
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono">{user?.email}</span>
        <button
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-accent hover:text-foreground"
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </header>
  );
}