import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PlainTextTagTextarea } from '@/components/ui/plain-text-tag-textarea';
import { cn } from '@/lib/utils';

type ChatMessage = {
  role: string;
  content: string;
  timestamp?: number;
  pending?: boolean;
  localId?: string;
};

interface ChatTabProps {
  projectId?: string;
  selectedSessionKey: string | null;
  sessionDisplayName: string;
  messages?: ChatMessage[];
  displayMessages: ChatMessage[];
  isLoading: boolean;
  isError: boolean;
  draftMessage: string;
  isSending: boolean;
  isGenerating: boolean;
  generatingStartedAt?: number;
  onDraftChange: (value: string) => void;
  onSend: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  onCmdEnter: () => void;
}

export function ChatTab({
  projectId,
  selectedSessionKey,
  sessionDisplayName,
  messages,
  displayMessages,
  isLoading,
  isError,
  draftMessage,
  isSending,
  isGenerating,
  generatingStartedAt,
  onDraftChange,
  onSend,
  onCmdEnter,
}: ChatTabProps) {
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isGenerating) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const elapsedSeconds = useMemo(() => {
    if (!isGenerating || !generatingStartedAt) return 0;
    return Math.max(0, Math.floor((now - generatingStartedAt) / 1000));
  }, [generatingStartedAt, isGenerating, now]);

  useEffect(() => {
    const chatMessagesEl = chatMessagesRef.current;
    if (!chatMessagesEl) return;
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, [selectedSessionKey, messages, displayMessages, isGenerating]);

  return (
    <section className="h-full min-h-0 flex flex-col gap-2 p-3">
      <div className="text-[11px] text-muted-foreground truncate">{sessionDisplayName}</div>
      <div ref={chatMessagesRef} className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {!selectedSessionKey ? (
          <div className="text-xs text-muted-foreground">
            Select an agent session to view chat history.
          </div>
        ) : isLoading ? (
          <div className="text-xs text-muted-foreground">Loading chat history...</div>
        ) : isError ? (
          <div className="text-xs text-muted-foreground">Failed to load chat history.</div>
        ) : displayMessages.length === 0 ? (
          <div className="text-xs text-muted-foreground">No chat messages yet.</div>
        ) : (
          displayMessages.map((msg, idx) => (
            <div
              key={msg.localId ?? `${msg.timestamp ?? 0}-${idx}`}
              className={cn(
                'px-2 py-1.5 text-xs whitespace-pre-wrap border-l-2',
                msg.role === 'user'
                  ? 'bg-primary/5 border-primary/30'
                  : 'bg-background border-border',
                msg.pending ? 'opacity-70' : undefined
              )}
            >
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {msg.role}
                {msg.pending ? ' (sending...)' : ''}
              </p>
              <p>{msg.content}</p>
            </div>
          ))
        )}
        {isGenerating ? (
          <div className="px-2 py-1.5 text-xs border-l-2 bg-muted/40 border-border text-muted-foreground tracking-wide">
            Thinking... {elapsedSeconds}s
          </div>
        ) : null}
      </div>
      <form onSubmit={onSend} className="space-y-2">
        <PlainTextTagTextarea
          value={draftMessage}
          onChange={onDraftChange}
          onCmdEnter={onCmdEnter}
          className="w-full min-h-20 border bg-background px-2 py-1.5 text-xs"
          placeholder="Send a message to this session..."
          disabled={!selectedSessionKey || isSending}
          projectId={projectId}
          rows={4}
          maxRows={10}
        />
        <button
          type="submit"
          disabled={!selectedSessionKey || !draftMessage.trim() || isSending}
          className="w-full border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
