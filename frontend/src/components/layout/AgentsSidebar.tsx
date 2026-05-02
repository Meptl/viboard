import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useProject } from '@/contexts/ProjectContext';
import { projectsApi } from '@/lib/api';
import { OpenInIdeButton } from '@/components/ide/OpenInIdeButton';
import { cn } from '@/lib/utils';
import { AgentsList } from './AgentsList';
import { ChatTab } from './ChatTab';
import { CronsTab } from './CronsTab';
import { MemoryTab } from './MemoryTab';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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

  const rootScopedMatch = key.match(
    /^((?:agent:[^:]+)):(?:subagent:.+|cron:[^:]+|(?:[^:]+:)*direct:.+|(?:[^:]+:)*channel:.+)$/
  );
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
  const queryClient = useQueryClient();
  const tabs: SidebarTab[] = ['Memory', 'Crons', 'Chat'];
  const openclawWorkspacePath = '~/.openclaw/workspace';
  const [activeTab, setActiveTab] = useState<SidebarTab>('Memory');
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    sessionKey: string;
    label: string;
  } | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
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
      flatAgents.find(
        ({ session }) => session.session_key === selectedSessionKey
      )?.session ?? null,
    [flatAgents, selectedSessionKey]
  );

  useEffect(() => {
    if (
      selectedSessionKey &&
      flatAgents.some(
        ({ session }) => session.session_key === selectedSessionKey
      )
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

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      projectsApi.sendOpenclawSessionMessage(
        projectId!,
        selectedSessionKey!,
        text
      ),
    onSuccess: () => {
      setDraftMessage('');
      void chatHistoryQuery.refetch();
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionKey: string) =>
      projectsApi.deleteOpenclawSession(projectId!, sessionKey),
    onSuccess: async (_, deletedSessionKey) => {
      if (selectedSessionKey === deletedSessionKey) {
        setSelectedSessionKey(null);
      }
      setDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ['openclaw-agents', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['openclaw-session-history', projectId],
      });
    },
  });

  const sendDraftMessage = async () => {
    const text = draftMessage.trim();
    if (!text || !projectId || !selectedSessionKey || sendMutation.isPending)
      return;
    await sendMutation.mutateAsync(text);
  };

  const openWorkspaceInIde = useMutation({
    mutationFn: () =>
      projectsApi.openOpenclawWorkspaceInEditor(projectId!, {
        editor_type: null,
        file_path: openclawWorkspacePath,
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
        <section className="flex-[0.5] min-h-0 bg-background overflow-hidden flex flex-col">
          <header className="border-b px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agents
            </h2>
          </header>
          <div className="flex-1 min-h-0 p-3">
            <div className="h-full min-h-0 overflow-y-auto space-y-2">
              <AgentsList
                isLoading={agentsQuery.isLoading}
                isError={agentsQuery.isError}
                flatAgents={flatAgents}
                selectedSessionKey={selectedSessionKey}
                deletingSessionKey={
                  deleteSessionMutation.isPending && deleteTarget
                    ? deleteTarget.sessionKey
                    : null
                }
                onSelectSession={setSelectedSessionKey}
                onDeleteSession={(sessionKey, label) => {
                  setDeleteTarget({ sessionKey, label });
                }}
              />
            </div>
          </div>
        </section>

        <div className="h-px bg-border" aria-hidden="true" />

        <section className="flex-[1.5] min-h-0 bg-muted/30 overflow-hidden">
          <div
            className="border-b bg-muted/40 px-2 py-1.5"
            role="tablist"
            aria-label="Agents workspace tabs"
          >
            <div className="flex items-center justify-between gap-2">
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
              <OpenInIdeButton
                onClick={() => {
                  if (!projectId || openWorkspaceInIde.isPending) return;
                  openWorkspaceInIde.mutate();
                }}
                disabled={!projectId || openWorkspaceInIde.isPending}
              />
            </div>
          </div>
          <div className="h-full overflow-y-auto">
            {activeTab === 'Chat' ? (
              <ChatTab
                projectId={projectId}
                selectedSessionKey={selectedSessionKey}
                sessionDisplayName={
                  selectedSession?.display_name ||
                  selectedSession?.label ||
                  selectedSession?.session_key ||
                  'No session selected'
                }
                messages={chatHistoryQuery.data?.messages}
                isLoading={chatHistoryQuery.isLoading}
                isError={chatHistoryQuery.isError}
                draftMessage={draftMessage}
                isSending={sendMutation.isPending}
                onDraftChange={setDraftMessage}
                onSend={onSend}
                onCmdEnter={() => {
                  void sendDraftMessage();
                }}
              />
            ) : activeTab === 'Memory' ? (
              <MemoryTab
                isLoading={memoriesQuery.isLoading}
                isError={memoriesQuery.isError}
                entries={memoriesQuery.data?.entries ?? []}
              />
            ) : activeTab === 'Crons' ? (
              <CronsTab
                projectId={projectId}
                isActive={activeTab === 'Crons'}
              />
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

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteSessionMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Agent Session</DialogTitle>
            <DialogDescription>
              This will permanently delete this agent session and any nested
              subagent sessions under it.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Session
            </p>
            <p className="mt-1 text-sm break-all">{deleteTarget?.label}</p>
            <p className="mt-1 text-xs text-muted-foreground break-all">
              {deleteTarget?.sessionKey}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleteSessionMutation.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || deleteSessionMutation.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteSessionMutation.mutate(deleteTarget.sessionKey);
              }}
            >
              {deleteSessionMutation.isPending ? 'Deleting...' : 'Delete agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
