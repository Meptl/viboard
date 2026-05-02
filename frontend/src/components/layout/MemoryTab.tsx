interface MemoryEntry {
  file: string;
  content: string;
}

interface MemoryTabProps {
  isLoading: boolean;
  isError: boolean;
  entries: MemoryEntry[];
}

export function MemoryTab({ isLoading, isError, entries }: MemoryTabProps) {
  return (
    <section className="p-3 space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Memory
      </h3>
      {isLoading ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          Loading memories...
        </div>
      ) : isError ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          Failed to load memories.
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          No memories found in this project workspace.
        </div>
      ) : (
        entries.map((entry) => (
          <div key={entry.file} className="rounded-md border bg-background p-2">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {entry.file}
            </p>
            <pre className="whitespace-pre-wrap text-xs">{entry.content}</pre>
          </div>
        ))
      )}
    </section>
  );
}
