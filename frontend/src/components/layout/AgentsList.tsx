import { cn } from '@/lib/utils';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type OpenClawAgentSession = {
  session_key: string;
  label?: string;
  display_name?: string;
  state?: string;
  agent_state?: string;
  model?: string;
  total_tokens?: number;
  context_tokens?: number;
};

type AgentNode = {
  session: OpenClawAgentSession;
  depth: number;
};

interface AgentsListProps {
  isLoading: boolean;
  isError: boolean;
  flatAgents: AgentNode[];
  selectedSessionKey: string | null;
  deletingSessionKey: string | null;
  onSelectSession: (sessionKey: string) => void;
  onDeleteSession: (sessionKey: string, label: string) => void;
}

export function AgentsList({
  isLoading,
  isError,
  flatAgents,
  selectedSessionKey,
  deletingSessionKey,
  onSelectSession,
  onDeleteSession,
}: AgentsListProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
        Loading agents...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
        Failed to load OpenClaw agents
      </div>
    );
  }

  if (flatAgents.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
        No active agents for this workspace
      </div>
    );
  }

  return flatAgents.map(({ session, depth }) => {
    const total = session.total_tokens ?? 0;
    const context = session.context_tokens ?? 0;
    const pct =
      context > 0 ? Math.min(100, Math.round((total / context) * 100)) : 0;
    const pctForMiniBar = pct > 0 ? Math.max(pct, 6) : 0;
    const fillClass =
      pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
    const label = session.display_name || session.label || session.session_key;

    return (
      <div
        key={session.session_key}
        className={cn(
          'rounded-md border bg-background px-2 py-1.5 cursor-pointer hover:bg-muted/30',
          selectedSessionKey === session.session_key
            ? 'border-primary/40 bg-primary/5'
            : ''
        )}
        style={{ marginLeft: `${depth * 10}px` }}
        onClick={() => onSelectSession(session.session_key)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-xs">{label}</p>
            <p className="text-[10px] text-muted-foreground">
              {session.model ?? 'model?'}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Agent actions"
                onClick={(e) => e.stopPropagation()}
              >
                <EllipsisVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                disabled={deletingSessionKey === session.session_key}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(session.session_key, label);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingSessionKey === session.session_key
                  ? 'Deleting...'
                  : 'Delete agent'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{session.agent_state ?? session.state ?? 'idle'}</span>
          <div
            className="flex items-center gap-1.5"
            aria-label={`${pct}% context used`}
          >
            <span>{pct}%</span>
            <div className="h-2 w-14 overflow-hidden rounded-full border border-border/60 bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', fillClass)}
                style={{ width: `${pctForMiniBar}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  });
}
