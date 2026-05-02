import { cn } from '@/lib/utils';

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
  onSelectSession: (sessionKey: string) => void;
}

export function AgentsList({
  isLoading,
  isError,
  flatAgents,
  selectedSessionKey,
  onSelectSession,
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
    const pct = context > 0 ? Math.min(100, Math.round((total / context) * 100)) : 0;
    const pctForMiniBar = pct > 0 ? Math.max(pct, 6) : 0;
    const fillClass =
      pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500';
    const label = session.display_name || session.label || session.session_key;

    return (
      <div
        key={session.session_key}
        className={cn(
          'rounded-md border bg-background px-2 py-1.5 cursor-pointer transition-colors',
          selectedSessionKey === session.session_key
            ? 'border-primary/40 bg-primary/5'
            : 'hover:bg-muted/40'
        )}
        style={{ marginLeft: `${depth * 10}px` }}
        onClick={() => onSelectSession(session.session_key)}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs">{label}</p>
          <p className="text-[10px] text-muted-foreground">
            {session.model ?? 'model?'}
          </p>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{session.agent_state ?? session.state ?? 'idle'}</span>
          <div className="flex items-center gap-1.5" aria-label={`${pct}% context used`}>
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
