import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { projectsApi } from '@/lib/api';
import { PlainTextTagTextarea } from '@/components/ui/plain-text-tag-textarea';
import { cn } from '@/lib/utils';
import { OpenInIdeButton } from '@/components/ide/OpenInIdeButton';
import { AgentsList } from './AgentsList';

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

function flattenAgentTree(sessions: OpenClawAgentSession[]): AgentNode[] {
  const byRecent = (a: OpenClawAgentSession, b: OpenClawAgentSession) =>
    (b.updated_at ?? 0) - (a.updated_at ?? 0);
  return [...sessions].sort(byRecent).map((session) => ({ session, depth: 0 }));
}

function AgentsSidebar() {
  const tabs = ['Memory', 'Crons', 'Chat'] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Memory');
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [cronForm, setCronForm] = useState({
    id: '',
    name: '',
    scheduleKind: 'every',
    everyMs: '3600000',
    cronExpr: '0 9 * * *',
    cronTz: '',
    at: '',
    prompt: '',
  });
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
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
  const selectedSession = useMemo(
    () =>
      flatAgents.find(({ session }) => session.session_key === selectedSessionKey)
        ?.session ?? null,
    [flatAgents, selectedSessionKey]
  );

  useEffect(() => {
    if (selectedSessionKey && flatAgents.some(({ session }) => session.session_key === selectedSessionKey)) {
      return;
    }
    setSelectedSessionKey(flatAgents[0]?.session.session_key ?? null);
  }, [flatAgents, selectedSessionKey]);

  const chatHistoryQuery = useQuery({
    queryKey: ['openclaw-session-history', projectId, selectedSessionKey],
    queryFn: () =>
      projectsApi.getOpenclawSessionHistory(projectId!, selectedSessionKey!),
    enabled: !!projectId && !!selectedSessionKey && activeTab === 'Chat',
    staleTime: 2_000,
    refetchInterval: activeTab === 'Chat' ? 5_000 : false,
  });

  const memoriesQuery = useQuery({
    queryKey: ['openclaw-memories', projectId],
    queryFn: () => projectsApi.getOpenclawMemories(projectId!),
    enabled: !!projectId && activeTab === 'Memory',
    staleTime: 5_000,
    refetchInterval: activeTab === 'Memory' ? 10_000 : false,
  });

  const cronsQuery = useQuery({
    queryKey: ['openclaw-crons', projectId],
    queryFn: () => projectsApi.getOpenclawCrons(projectId!),
    enabled: !!projectId && activeTab === 'Crons',
    staleTime: 5_000,
    refetchInterval: activeTab === 'Crons' ? 10_000 : false,
  });

  useEffect(() => {
    const chatMessagesEl = chatMessagesRef.current;
    if (!chatMessagesEl || activeTab !== 'Chat') return;
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, [activeTab, selectedSessionKey, chatHistoryQuery.data?.messages]);

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      projectsApi.sendOpenclawSessionMessage(projectId!, selectedSessionKey!, text),
    onSuccess: () => {
      setDraftMessage('');
      void chatHistoryQuery.refetch();
    },
  });

  const sendDraftMessage = async () => {
    const text = draftMessage.trim();
    if (!text || !projectId || !selectedSessionKey || sendMutation.isPending) return;
    await sendMutation.mutateAsync(text);
  };

  const openWorkspaceInIde = useMutation({
    mutationFn: () =>
      projectsApi.openOpenclawWorkspaceInEditor(projectId!, {
        editor_type: null,
        file_path: null,
      }),
    onSuccess: (response) => {
      if (response.url) window.open(response.url, '_blank');
    },
  });

  const createCronMutation = useMutation({
    mutationFn: () => {
      const schedule =
        cronForm.scheduleKind === 'cron'
          ? {
              kind: 'cron',
              expr: cronForm.cronExpr.trim(),
              ...(cronForm.cronTz.trim() ? { tz: cronForm.cronTz.trim() } : {}),
            }
          : cronForm.scheduleKind === 'at'
            ? { kind: 'at', at: new Date(cronForm.at).toISOString() }
            : { kind: 'every', everyMs: Number(cronForm.everyMs || '3600000') };

      return projectsApi.createOpenclawCron(projectId!, {
        name: cronForm.name.trim() || undefined,
        enabled: true,
        schedule,
        payload: { kind: 'agentTurn', message: cronForm.prompt.trim() },
      });
    },
    onSuccess: async () => {
      setCronForm({
        id: '',
        name: '',
        scheduleKind: 'every',
        everyMs: '3600000',
        cronExpr: '0 9 * * *',
        cronTz: '',
        at: '',
        prompt: '',
      });
      await cronsQuery.refetch();
    },
  });

  const updateCronMutation = useMutation({
    mutationFn: () => {
      const schedule =
        cronForm.scheduleKind === 'cron'
          ? {
              kind: 'cron',
              expr: cronForm.cronExpr.trim(),
              ...(cronForm.cronTz.trim() ? { tz: cronForm.cronTz.trim() } : {}),
            }
          : cronForm.scheduleKind === 'at'
            ? { kind: 'at', at: new Date(cronForm.at).toISOString() }
            : { kind: 'every', everyMs: Number(cronForm.everyMs || '3600000') };

      return projectsApi.updateOpenclawCron(projectId!, cronForm.id, {
        name: cronForm.name.trim() || undefined,
        enabled: true,
        schedule,
        payload: { kind: 'agentTurn', message: cronForm.prompt.trim() },
      });
    },
    onSuccess: async () => {
      setCronForm((prev) => ({ ...prev, id: '' }));
      await cronsQuery.refetch();
    },
  });

  const deleteCronMutation = useMutation({
    mutationFn: (cronId: string) => projectsApi.deleteOpenclawCron(projectId!, cronId),
    onSuccess: async () => {
      await cronsQuery.refetch();
    },
  });

  const toggleCronMutation = useMutation({
    mutationFn: ({ cronId, enabled }: { cronId: string; enabled: boolean }) =>
      projectsApi.toggleOpenclawCron(projectId!, cronId, enabled),
    onSuccess: async () => {
      await cronsQuery.refetch();
    },
  });

  const onSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await sendDraftMessage();
  };

  return (
    <aside className="h-full min-h-0 w-[30rem] shrink-0 border-l-2 bg-muted/20 py-2">
      <div className="h-full min-h-0 flex flex-col">
        <section className="flex-[0.5] min-h-0 bg-background overflow-hidden">
          <header className="border-b px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Agents
              </h2>
              <OpenInIdeButton
                onClick={() => {
                  if (!projectId || openWorkspaceInIde.isPending) return;
                  openWorkspaceInIde.mutate();
                }}
                disabled={!projectId || openWorkspaceInIde.isPending}
              />
            </div>
          </header>
          <div className="h-full overflow-y-auto p-3 space-y-2">
            <AgentsList
              isLoading={agentsQuery.isLoading}
              isError={agentsQuery.isError}
              flatAgents={flatAgents}
              selectedSessionKey={selectedSessionKey}
              onSelectSession={setSelectedSessionKey}
            />
          </div>
        </section>

        <div className="h-px bg-border" aria-hidden="true" />

        <section className="flex-[1.5] min-h-0 bg-muted/30 overflow-hidden">
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
          <div className="h-full overflow-y-auto">
            {activeTab === 'Chat' ? (
              <section className="h-full min-h-0 flex flex-col gap-2 p-3">
                <div className="text-[11px] text-muted-foreground truncate">
                  {selectedSession?.display_name ||
                    selectedSession?.label ||
                    selectedSession?.session_key ||
                    'No session selected'}
                </div>
                <div
                  ref={chatMessagesRef}
                  className="flex-1 min-h-0 overflow-y-auto space-y-2"
                >
                  {!selectedSessionKey ? (
                    <div className="text-xs text-muted-foreground">
                      Select an agent session to view chat history.
                    </div>
                  ) : chatHistoryQuery.isLoading ? (
                    <div className="text-xs text-muted-foreground">
                      Loading chat history...
                    </div>
                  ) : chatHistoryQuery.isError ? (
                    <div className="text-xs text-muted-foreground">
                      Failed to load chat history.
                    </div>
                  ) : (chatHistoryQuery.data?.messages?.length ?? 0) === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No chat messages yet.
                    </div>
                  ) : (
                    chatHistoryQuery.data?.messages.map((msg, idx) => (
                      <div
                        key={`${msg.timestamp ?? 0}-${idx}`}
                        className={cn(
                          'px-2 py-1.5 text-xs whitespace-pre-wrap border-l-2',
                          msg.role === 'user'
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-background border-border'
                        )}
                      >
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {msg.role}
                        </p>
                        <p>{msg.content}</p>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={onSend} className="space-y-2">
                  <PlainTextTagTextarea
                    value={draftMessage}
                    onChange={setDraftMessage}
                    onCmdEnter={() => {
                      void sendDraftMessage();
                    }}
                    className="w-full min-h-20 border bg-background px-2 py-1.5 text-xs"
                    placeholder="Send a message to this session..."
                    disabled={!selectedSessionKey || sendMutation.isPending}
                    projectId={projectId}
                    rows={4}
                    maxRows={10}
                  />
                  <button
                    type="submit"
                    disabled={
                      !selectedSessionKey ||
                      !draftMessage.trim() ||
                      sendMutation.isPending
                    }
                    className="w-full border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {sendMutation.isPending ? 'Sending...' : 'Send'}
                  </button>
                </form>
              </section>
            ) : activeTab === 'Memory' ? (
              <section className="p-3 space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Memory
                </h3>
                {memoriesQuery.isLoading ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    Loading memories...
                  </div>
                ) : memoriesQuery.isError ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    Failed to load memories.
                  </div>
                ) : (memoriesQuery.data?.entries.length ?? 0) === 0 ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    No memories found in this project workspace.
                  </div>
                ) : (
                  memoriesQuery.data?.entries.map((entry) => (
                    <div key={entry.file} className="rounded-md border bg-background p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {entry.file}
                      </p>
                      <pre className="whitespace-pre-wrap text-xs">{entry.content}</pre>
                    </div>
                  ))
                )}
              </section>
            ) : activeTab === 'Crons' ? (
              <section className="p-3 space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Crons
                </h3>
                <form
                  className="space-y-2 rounded-md border bg-background p-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!cronForm.prompt.trim()) return;
                    if (cronForm.id) await updateCronMutation.mutateAsync();
                    else await createCronMutation.mutateAsync();
                  }}
                >
                  <input
                    value={cronForm.name}
                    onChange={(e) => setCronForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Name (optional)"
                    className="w-full border bg-background px-2 py-1.5 text-xs"
                  />
                  <select
                    value={cronForm.scheduleKind}
                    onChange={(e) =>
                      setCronForm((p) => ({ ...p, scheduleKind: e.target.value }))
                    }
                    className="w-full border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="every">Recurring interval</option>
                    <option value="cron">Cron expression</option>
                    <option value="at">One-shot at time</option>
                  </select>
                  {cronForm.scheduleKind === 'every' ? (
                    <select
                      value={cronForm.everyMs}
                      onChange={(e) =>
                        setCronForm((p) => ({ ...p, everyMs: e.target.value }))
                      }
                      className="w-full border bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="300000">5 minutes</option>
                      <option value="900000">15 minutes</option>
                      <option value="1800000">30 minutes</option>
                      <option value="3600000">1 hour</option>
                      <option value="7200000">2 hours</option>
                      <option value="21600000">6 hours</option>
                      <option value="43200000">12 hours</option>
                      <option value="86400000">24 hours</option>
                    </select>
                  ) : cronForm.scheduleKind === 'cron' ? (
                    <>
                      <input
                        value={cronForm.cronExpr}
                        onChange={(e) =>
                          setCronForm((p) => ({ ...p, cronExpr: e.target.value }))
                        }
                        placeholder="0 9 * * *"
                        className="w-full border bg-background px-2 py-1.5 text-xs"
                      />
                      <input
                        value={cronForm.cronTz}
                        onChange={(e) =>
                          setCronForm((p) => ({ ...p, cronTz: e.target.value }))
                        }
                        placeholder="Timezone (optional)"
                        className="w-full border bg-background px-2 py-1.5 text-xs"
                      />
                    </>
                  ) : (
                    <input
                      type="datetime-local"
                      value={cronForm.at}
                      onChange={(e) => setCronForm((p) => ({ ...p, at: e.target.value }))}
                      className="w-full border bg-background px-2 py-1.5 text-xs"
                    />
                  )}
                  <textarea
                    value={cronForm.prompt}
                    onChange={(e) => setCronForm((p) => ({ ...p, prompt: e.target.value }))}
                    placeholder="Prompt"
                    className="w-full min-h-20 border bg-background px-2 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={createCronMutation.isPending || updateCronMutation.isPending}
                    className="w-full border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {cronForm.id ? 'Update cron' : 'Create cron'}
                  </button>
                </form>
                {cronsQuery.isLoading ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    Loading crons...
                  </div>
                ) : cronsQuery.isError ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    Failed to load crons.
                  </div>
                ) : (cronsQuery.data?.jobs.length ?? 0) === 0 ? (
                  <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                    No crons configured for this project workspace.
                  </div>
                ) : (
                  cronsQuery.data?.jobs.map((job) => (
                    <div key={job.id} className="rounded-md border bg-background p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium">{job.name || job.id}</p>
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={job.enabled}
                            onChange={(e) =>
                              toggleCronMutation.mutate({
                                cronId: job.id,
                                enabled: e.target.checked,
                              })
                            }
                          />
                          enabled
                        </label>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {job.schedule.kind === 'every'
                          ? `Every ${Math.round((job.schedule.every_ms ?? 0) / 60000)} minutes`
                          : job.schedule.kind === 'cron'
                            ? `Cron: ${job.schedule.expr ?? ''}${job.schedule.tz ? ` (${job.schedule.tz})` : ''}`
                            : `At ${job.schedule.at ?? ''}`}
                      </p>
                      <p className="whitespace-pre-wrap text-xs">{job.payload.prompt}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="border px-2 py-1 text-xs"
                          onClick={() =>
                            setCronForm({
                              id: job.id,
                              name: job.name || '',
                              scheduleKind: job.schedule.kind || 'every',
                              everyMs: String(job.schedule.every_ms ?? 3600000),
                              cronExpr: job.schedule.expr ?? '0 9 * * *',
                              cronTz: job.schedule.tz ?? '',
                              at: job.schedule.at
                                ? new Date(job.schedule.at).toISOString().slice(0, 16)
                                : '',
                              prompt: job.payload.prompt ?? '',
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="border px-2 py-1 text-xs text-destructive"
                          onClick={() => deleteCronMutation.mutate(job.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </section>
            ) : (
              <section className="p-3 space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {activeTab}
                </h3>
                <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                  OpenClaw integration pending
                </div>
              </section>
            )}
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
