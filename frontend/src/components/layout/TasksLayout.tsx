import { ReactNode, useEffect, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserSystem } from '@/components/ConfigProvider';
import { configApi } from '@/lib/api';

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

type OpenClawConnectionStatus = 'checking' | 'connected' | 'failed';

function getOpenClawConnectionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unable to connect to the gateway.';
  }

  const normalized = error.message.toLowerCase();
  if (
    normalized.includes('networkerror') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('load failed')
  ) {
    return 'Cannot reach the gateway. This is usually a network, mixed-content, or bad URL issue.';
  }

  return error.message;
}

function AgentsSidebarSkeleton() {
  const tabs = ['Memory', 'Crons', 'Chat', 'Configs'] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Memory');
  const { config } = useUserSystem();
  const [status, setStatus] = useState<OpenClawConnectionStatus>('checking');
  const [statusMessage, setStatusMessage] = useState('Checking gateway...');

  useEffect(() => {
    const gatewayUrl = config?.openclaw?.gateway_url?.trim();
    const gatewayKey = config?.openclaw?.gateway_key?.trim();

    if (!gatewayUrl || !gatewayKey) {
      setStatus('failed');
      setStatusMessage('Gateway URL or key is missing in settings.');
      return;
    }

    setStatus('checking');
    setStatusMessage('Checking gateway...');

    const checkConnection = async () => {
      try {
        const health = await configApi.checkOpenClawHealth();
        if (!health.ok) {
          setStatus('failed');
          setStatusMessage(health.message);
          return;
        }

        setStatus('connected');
        setStatusMessage(health.message || 'Connected');
      } catch (error) {
        setStatus('failed');
        setStatusMessage(getOpenClawConnectionErrorMessage(error));
      }
    };

    void checkConnection();
    return undefined;
  }, [config?.openclaw?.gateway_key, config?.openclaw?.gateway_url]);

  return (
    <aside className="h-full min-h-0 w-80 shrink-0 border-l bg-muted/20 p-2">
      <div className="h-full min-h-0 flex flex-col gap-2">
        {status === 'failed' ? (
          <section className="h-full min-h-0 rounded-xl border bg-background p-3 text-warning-foreground dark:text-warning flex items-center">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>OpenClaw Connection Failed</span>
              </h2>
              <p className="mt-2 text-xs break-words">{statusMessage}</p>
              <Link
                to="/settings/general#openclaw-settings"
                className="mt-3 inline-block text-xs underline underline-offset-2"
              >
                Open OpenClaw settings
              </Link>
            </div>
          </section>
        ) : (
          <>
        <section className="flex-1 min-h-0 rounded-xl border bg-background overflow-hidden">
          <header className="border-b px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agents
            </h2>
          </header>
          <div className="h-full overflow-y-auto p-3 space-y-2">
            <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
              No active agents
            </div>
            <div
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs',
                status === 'connected'
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-warning/40 bg-warning/10 text-warning-foreground dark:text-warning'
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {status === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {status === 'connected' && <CheckCircle2 className="h-3.5 w-3.5" />}
                <span>OpenClaw gateway</span>
              </div>
              <p className="mt-1">{statusMessage}</p>
            </div>
          </div>
        </section>

        <section className="flex-1 min-h-0 rounded-xl border bg-background overflow-hidden">
          <div
            className="border-b bg-background/80 px-2 py-1.5"
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
                        ? 'bg-primary/10 text-primary'
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
            <section className="rounded-lg border bg-background p-3 space-y-2">
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
          </>
        )}
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
        <AgentsSidebarSkeleton />
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
