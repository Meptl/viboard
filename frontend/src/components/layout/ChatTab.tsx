import { FormEvent, useEffect, useRef } from 'react';
import { PlainTextTagTextarea } from '@/components/ui/plain-text-tag-textarea';
import { cn } from '@/lib/utils';

type ChatMessage = {
  role: string;
  content: string;
  timestamp?: number;
};

interface ChatTabProps {
  projectId?: string;
  selectedSessionKey: string | null;
  sessionDisplayName: string;
  messages?: ChatMessage[];
  isLoading: boolean;
  isError: boolean;
  draftMessage: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onSend: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  onCmdEnter: () => void;
}

export function ChatTab({
  projectId,
  selectedSessionKey,
  sessionDisplayName,
  messages,
  isLoading,
  isError,
  draftMessage,
  isSending,
  onDraftChange,
  onSend,
  onCmdEnter,
}: ChatTabProps) {
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const chatMessagesEl = chatMessagesRef.current;
    if (!chatMessagesEl) return;
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, [selectedSessionKey, messages]);

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
        ) : (messages?.length ?? 0) === 0 ? (
          <div className="text-xs text-muted-foreground">No chat messages yet.</div>
        ) : (
          messages?.map((msg, idx) => (
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
