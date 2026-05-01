import { ReactNode, useMemo, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { projectsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export type LayoutMode = 'preview' | 'diffs' | null;

interface TasksLayoutProps {
  kanban: ReactNode;
  attempt: ReactNode;
  aux: ReactNode;
  isPanelOpen: boolean;
  mode: LayoutMode;
  rightHeader?: ReactNode;
}

type SplitSizes = [number, number];

const MIN_PANEL_SIZE = 20;
const DEFAULT_KANBAN_ATTEMPT: SplitSizes = [66, 34];
const DEFAULT_ATTEMPT_AUX: SplitSizes = [34, 66];

const STORAGE_KEYS = {
  KANBAN_ATTEMPT: 'tasksLayout.desktop.v2.kanbanAttempt',
  ATTEMPT_AUX: 'tasksLayout.desktop.v2.attemptAux',
} as const;

function loadSizes(key: string, fallback: SplitSizes): SplitSizes {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length === 2)
      return parsed as SplitSizes;
    return fallback;
  } catch {
    return fallback;
  }
}

function saveSizes(key: string, sizes: SplitSizes): void {
  try {
    localStorage.setItem(key, JSON.stringify(sizes));
  } catch {
    // Ignore errors
  }
}

/**
 * AuxRouter - Handles nested AnimatePresence for preview/diffs transitions.
 */
function AuxRouter({ mode, aux }: { mode: LayoutMode; aux: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {mode && (
        <motion.div
          key={mode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="h-full min-h-0"
        >
          {aux}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type OpenClawAgentSession = {
  session_key: string;
  label?: string;
  display_name?: string;
  state?: string;
  agent_state?: string;
  busy?: boolean;
  processing?: boolean;
  status?: string;
  updated_at?: number;
  model?: string;
  thinking?: string;
  total_tokens?: number;
  context_tokens?: number;
  parent_session_key?: string;
};

type AgentNode = {
  session: OpenClawAgentSession;
  depth: number;
};

function inferParentSessionKey(
  session: OpenClawAgentSession
): string | undefined {
  if (session.parent_session_key?.trim()) return session.parent_session_key;
  const key = session.session_key;
  const subagentMatch = key.match(/^agent:([^:]+):subagent:[^:]+:.+$/);
  if (subagentMatch) {
    return `agent:${subagentMatch[1]}:main`;
  }
  return undefined;
}

function flattenAgentTree(sessions: OpenClawAgentSession[]): AgentNode[] {
  if (sessions.length === 0) return [];

  const byKey = new Map(sessions.map((s) => [s.session_key, s]));
  const children = new Map<string, OpenClawAgentSession[]>();
  const roots: OpenClawAgentSession[] = [];

  for (const session of sessions) {
    const parentKey = inferParentSessionKey(session);
    if (parentKey && byKey.has(parentKey)) {
      const list = children.get(parentKey);
      if (list) list.push(session);
      else children.set(parentKey, [session]);
    } else {
      roots.push(session);
    }
  }

  const byRecent = (a: OpenClawAgentSession, b: OpenClawAgentSession) =>
    (b.updated_at ?? 0) - (a.updated_at ?? 0);
  roots.sort(byRecent);
  for (const list of children.values()) list.sort(byRecent);

  const output: AgentNode[] = [];
  const walk = (nodes: OpenClawAgentSession[], depth: number) => {
    for (const node of nodes) {
      output.push({ session: node, depth });
      walk(children.get(node.session_key) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return output;
}

function AgentsSidebar() {
  const tabs = ['Memory', 'Crons', 'Chat', 'Configs'] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Memory');
  const { projectId } = useProject();

  const agentsQuery = useQuery({
    queryKey: ['openclaw-agents', projectId],
    queryFn: () => projectsApi.getOpenclawAgents(projectId!),
    enabled: !!projectId,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const flatAgents = useMemo(
    () => flattenAgentTree(agentsQuery.data?.sessions ?? []),
    [agentsQuery.data?.sessions]
  );

  return (
    <aside className="h-full min-h-0 w-80 shrink-0 border-l bg-muted/20 py-2">
      <div className="h-full min-h-0 flex flex-col">
        <section className="flex-1 min-h-0 bg-background overflow-hidden">
          <header className="border-b px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agents
            </h2>
          </header>
          <div className="h-full overflow-y-auto p-3 space-y-2">
            {agentsQuery.isLoading ? (
              <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                Loading agents...
              </div>
            ) : agentsQuery.isError ? (
              <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                Failed to load OpenClaw agents
              </div>
            ) : flatAgents.length === 0 ? (
              <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                No active agents for this workspace
              </div>
            ) : (
              flatAgents.map(({ session, depth }) => {
                const total = session.total_tokens ?? 0;
                const context = session.context_tokens ?? 0;
                const pct =
                  context > 0 ? Math.min(100, Math.round((total / context) * 100)) : 0;
                const label =
                  session.display_name || session.label || session.session_key;
                return (
                  <div
                    key={session.session_key}
                    className="rounded-md border bg-background px-2 py-1.5"
                    style={{ marginLeft: `${depth * 10}px` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs">{label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {session.model ?? 'model?'}
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-muted">
                      <div
                        className="h-1.5 rounded bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{session.agent_state ?? session.state ?? 'idle'}</span>
                      <span>
                        {total}/{context || '?'} ({pct}%)
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <div className="h-px bg-border" aria-hidden="true" />

        <section className="flex-1 min-h-0 bg-muted/30 overflow-hidden">
          <div
            className="border-b bg-muted/40 px-2 py-1.5"
            role="tablist"
            aria-label="Agents workspace tabs"
          >
            <div className="flex flex-wrap gap-1">
              {tabs.map((tab) => {
                const isActive = tab === activeTab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={cn(
                      'rounded-md px-2 py-1 text-[11px] uppercase tracking-wide transition-colors',
                      isActive
                        ? 'bg-accent font-semibold text-foreground border border-border/60'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-full overflow-y-auto p-3">
            <section className="bg-muted/30 p-3 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {activeTab}
              </h3>
              <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                OpenClaw integration pending
              </div>
              <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                Skeleton panel only
              </div>
            </section>
          </div>
        </section>
      </div>
    </aside>
  );
}

/**
 * RightWorkArea - Contains header and Attempt/Aux content.
 * Shows just Attempt when mode === null, or Attempt | Aux split when mode !== null.
 */
function RightWorkArea({
  attempt,
  aux,
  mode,
  rightHeader,
}: {
  attempt: ReactNode;
  aux: ReactNode;
  mode: LayoutMode;
  rightHeader?: ReactNode;
}) {
  const [innerSizes] = useState<SplitSizes>(() =>
    loadSizes(STORAGE_KEYS.ATTEMPT_AUX, DEFAULT_ATTEMPT_AUX)
  );
  const [isAttemptCollapsed, setIsAttemptCollapsed] = useState(false);

  const mainContent = (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {rightHeader && (
        <div className="shrink-0 sticky top-0 z-20 bg-background border-b">
          {rightHeader}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {mode === null ? (
          attempt
        ) : (
          <PanelGroup
            direction="horizontal"
            className="h-full min-h-0"
            onLayout={(layout) => {
              if (layout.length === 2) {
                saveSizes(STORAGE_KEYS.ATTEMPT_AUX, [layout[0], layout[1]]);
              }
            }}
          >
            <Panel
              id="attempt"
              order={1}
              defaultSize={innerSizes[0]}
              minSize={MIN_PANEL_SIZE}
              collapsible
              collapsedSize={0}
              onCollapse={() => setIsAttemptCollapsed(true)}
              onExpand={() => setIsAttemptCollapsed(false)}
              className="min-w-0 min-h-0 overflow-hidden"
              role="region"
              aria-label="Details"
            >
              {attempt}
            </Panel>

            <PanelResizeHandle
              id="handle-aa"
              className={cn(
                'relative z-30 bg-border cursor-col-resize group touch-none',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                'transition-all',
                isAttemptCollapsed ? 'w-6' : 'w-1'
              )}
              aria-label="Resize panels"
              role="separator"
              aria-orientation="vertical"
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border" />
              <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 bg-muted/90 border border-border rounded-full px-1.5 py-3 opacity-70 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-sm">
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              </div>
            </PanelResizeHandle>

            <Panel
              id="aux"
              order={2}
              defaultSize={innerSizes[1]}
              minSize={MIN_PANEL_SIZE}
              collapsible={false}
              className="min-w-0 min-h-0 overflow-hidden"
              role="region"
              aria-label={mode === 'preview' ? 'Preview' : 'Diffs'}
            >
              <AuxRouter mode={mode} aux={aux} />
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );

  return <div className="h-full min-h-0 flex">{mainContent}</div>;
}

/**
 * DesktopSimple - Conditionally renders layout based on mode.
 * When mode === null: Shows Kanban | Attempt
 * When mode !== null: Hides Kanban, shows only RightWorkArea with Attempt | Aux
 */
function DesktopSimple({
  kanban,
  attempt,
  aux,
  mode,
  rightHeader,
}: {
  kanban: ReactNode;
  attempt: ReactNode;
  aux: ReactNode;
  mode: LayoutMode;
  rightHeader?: ReactNode;
}) {
  const [outerSizes] = useState<SplitSizes>(() =>
    loadSizes(STORAGE_KEYS.KANBAN_ATTEMPT, DEFAULT_KANBAN_ATTEMPT)
  );
  const [isKanbanCollapsed, setIsKanbanCollapsed] = useState(false);

  // When preview/diffs is open, hide Kanban entirely and render only RightWorkArea
  if (mode !== null) {
    return (
      <RightWorkArea
        attempt={attempt}
        aux={aux}
        mode={mode}
        rightHeader={rightHeader}
      />
    );
  }

  // When only viewing attempt logs, show Kanban | Attempt (no aux)
  return (
    <PanelGroup
      direction="horizontal"
      className="h-full min-h-0"
      onLayout={(layout) => {
        if (layout.length === 2) {
          saveSizes(STORAGE_KEYS.KANBAN_ATTEMPT, [layout[0], layout[1]]);
        }
      }}
    >
      <Panel
        id="kanban"
        order={1}
        defaultSize={outerSizes[0]}
        minSize={MIN_PANEL_SIZE}
        collapsible
        collapsedSize={0}
        onCollapse={() => setIsKanbanCollapsed(true)}
        onExpand={() => setIsKanbanCollapsed(false)}
        className="min-w-0 min-h-0 overflow-hidden"
        role="region"
        aria-label="Kanban board"
      >
        {kanban}
      </Panel>

      <PanelResizeHandle
        id="handle-kr"
        className={cn(
          'relative z-30 bg-border cursor-col-resize group touch-none',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'transition-all',
          isKanbanCollapsed ? 'w-6' : 'w-1'
        )}
        aria-label="Resize panels"
        role="separator"
        aria-orientation="vertical"
      >
        <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 bg-muted/90 border border-border rounded-full px-1.5 py-3 opacity-70 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-sm">
          <span className="w-1 h-1 rounded-full bg-muted-foreground" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground" />
          <span className="w-1 h-1 rounded-full bg-muted-foreground" />
        </div>
      </PanelResizeHandle>

      <Panel
        id="right"
        order={2}
        defaultSize={outerSizes[1]}
        minSize={MIN_PANEL_SIZE}
        collapsible={false}
        className="min-w-0 min-h-0 overflow-hidden"
      >
        <RightWorkArea
          attempt={attempt}
          aux={aux}
          mode={mode}
          rightHeader={rightHeader}
        />
      </Panel>
    </PanelGroup>
  );
}

export function TasksLayout({
  kanban,
  attempt,
  aux,
  isPanelOpen,
  mode,
  rightHeader,
}: TasksLayoutProps) {
  const desktopKey = isPanelOpen ? 'desktop-with-panel' : 'kanban-only';

  let desktopNode: ReactNode;

  if (!isPanelOpen) {
    desktopNode = (
      <div className="h-full min-h-0 flex">
        <div
          className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
          role="region"
          aria-label="Kanban board"
        >
          {kanban}
        </div>
        <AgentsSidebar />
      </div>
    );
  } else {
    desktopNode = (
      <DesktopSimple
        kanban={kanban}
        attempt={attempt}
        aux={aux}
        mode={mode}
        rightHeader={rightHeader}
      />
    );
  }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={desktopKey}
        className="h-full min-h-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
      >
        {desktopNode}
      </motion.div>
    </AnimatePresence>
  );
}
