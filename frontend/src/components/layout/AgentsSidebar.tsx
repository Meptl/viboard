import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { projectsApi } from '@/lib/api';
import { PlainTextTagTextarea } from '@/components/ui/plain-text-tag-textarea';
import { OpenInIdeButton } from '@/components/ide/OpenInIdeButton';
import { cn } from '@/lib/utils';
import { AgentsList } from './AgentsList';
import { CronsTab } from './CronsTab';
import { MemoryTab } from './MemoryTab';

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

type SidebarTab = 'Memory' | 'Crons' | 'Chat';

function inferParentSessionKey(
  session: OpenClawAgentSession
): string | undefined {
  if (session.parent_session_key?.trim()) return session.parent_session_key;
  const key = session.session_key;
  const cronRunMatch = key.match(/^(.+:cron:[^:]+):run:.+$/);
  if (cronRunMatch) return cronRunMatch[1];

  const rootScopedMatch = key.match(/^((?:agent:[^:]+)):(?:subagent:.+|cron:[^:]+|(?:[^:]+:)*direct:.+|(?:[^:]+:)*channel:.+)$/);
  if (rootScopedMatch) return `${rootScopedMatch[1]}:main`;

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

export function AgentsSidebar() {
  const tabs: SidebarTab[] = ['Memory', 'Crons', 'Chat'];
  const [activeTab, setActiveTab] = useState<SidebarTab>('Memory');
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
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
    if (
      selectedSessionKey &&
      flatAgents.some(({ session }) => session.session_key === selectedSessionKey)
    ) {
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
              <MemoryTab
                isLoading={memoriesQuery.isLoading}
                isError={memoriesQuery.isError}
                entries={memoriesQuery.data?.entries ?? []}
              />
            ) : activeTab === 'Crons' ? (
              <CronsTab projectId={projectId} isActive={activeTab === 'Crons'} />
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
