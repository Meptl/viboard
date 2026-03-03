import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { FileText, List, Tag as TagIcon } from 'lucide-react';
import { AutoExpandingTextarea } from '@/components/ui/auto-expanding-textarea';
import { cn } from '@/lib/utils';
import {
  searchTagsAndFiles,
  type SearchResultItem,
} from '@/lib/searchTagsAndFiles';
import { useProjectTasksSnapshot } from '@/contexts/ProjectTasksSnapshotContext';

const MAX_DIALOG_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
const VERTICAL_GAP = 4;
const MIN_WIDTH = 320;

interface PlainTextTagTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  projectId?: string;
  onCmdEnter?: () => void;
  onShiftCmdEnter?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPasteFiles?: (files: File[]) => void;
  autoFocus?: boolean;
  rows?: number;
  maxRows?: number;
  disableInternalScroll?: boolean;
  closeMenuSignal?: number;
}

type ActiveQuery = {
  query: string;
  start: number;
  end: number;
};

function getMenuPosition(textareaEl: HTMLTextAreaElement) {
  const rect = textareaEl.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const showBelow = spaceBelow >= spaceAbove;
  const availableVerticalSpace = showBelow ? spaceBelow : spaceAbove;

  const maxHeight = Math.max(
    0,
    Math.min(MAX_DIALOG_HEIGHT, availableVerticalSpace - 2 * VIEWPORT_MARGIN)
  );

  let top: number | undefined;
  let bottom: number | undefined;

  if (showBelow) {
    top = rect.bottom + VERTICAL_GAP;
  } else {
    bottom = viewportHeight - rect.top + VERTICAL_GAP;
  }

  let left = rect.left;
  const maxLeft = viewportWidth - MIN_WIDTH - VIEWPORT_MARGIN;
  if (left > maxLeft) {
    left = Math.max(VIEWPORT_MARGIN, maxLeft);
  }

  return { top, bottom, left, maxHeight };
}

function getActiveAtQuery(text: string, cursor: number): ActiveQuery | null {
  const beforeCursor = text.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) return null;

  const query = match[1] ?? '';
  const triggerIndex = beforeCursor.lastIndexOf(`@${query}`);
  if (triggerIndex === -1) return null;

  return {
    query,
    start: triggerIndex,
    end: cursor,
  };
}

export function PlainTextTagTextarea({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  projectId,
  onCmdEnter,
  onShiftCmdEnter,
  onKeyDown,
  onPasteFiles,
  autoFocus = false,
  rows = 3,
  maxRows = 10,
  disableInternalScroll = false,
  closeMenuSignal,
}: PlainTextTagTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const requestIdRef = useRef(0);
  const projectTasksSnapshot = useProjectTasksSnapshot();
  const taskSnapshot =
    projectTasksSnapshot && projectId === projectTasksSnapshot.projectId
      ? projectTasksSnapshot.tasks
      : undefined;

  const [activeQuery, setActiveQuery] = useState<ActiveQuery | null>(null);
  const [options, setOptions] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!activeQuery) {
      requestIdRef.current += 1;
      setOptions([]);
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const results = await searchTagsAndFiles(activeQuery.query, projectId, {
          includeTasks: true,
          taskSnapshot,
        });
        if (requestIdRef.current !== currentRequestId) return;
        setOptions(results);
        setIsOpen(true);
        setSelectedIndex(results.length > 0 ? 0 : -1);
      } catch (error) {
        if (requestIdRef.current !== currentRequestId) return;
        console.error('Failed to search tags/files/tasks', error);
        setOptions([]);
        setIsOpen(true);
        setSelectedIndex(-1);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [activeQuery, projectId, taskSnapshot]);

  useEffect(() => {
    if (!isOpen || selectedIndex < 0) return;
    const el = itemRefs.current.get(selectedIndex);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, selectedIndex]);

  useEffect(() => {
    setIsOpen(false);
    setActiveQuery(null);
    setOptions([]);
    setSelectedIndex(-1);
    requestIdRef.current += 1;
  }, [closeMenuSignal]);

  const updateQueryFromTextarea = useCallback(
    (target: HTMLTextAreaElement) => {
      const cursor = target.selectionStart ?? 0;
      const nextQuery = getActiveAtQuery(target.value, cursor);
      setActiveQuery((prev) => {
        if (!prev && !nextQuery) return prev;
        if (!prev || !nextQuery) return nextQuery;
        if (
          prev.query === nextQuery.query &&
          prev.start === nextQuery.start &&
          prev.end === nextQuery.end
        ) {
          return prev;
        }
        return nextQuery;
      });
    },
    []
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      updateQueryFromTextarea(e.target);
    },
    [onChange, updateQueryFromTextarea]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onPasteFiles || disabled) return;
      const dt = event.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files || []).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length > 0) {
        onPasteFiles(files);
      }
    },
    [onPasteFiles, disabled]
  );

  const insertSelection = useCallback(
    (item: SearchResultItem) => {
      if (!textareaRef.current || !activeQuery) return;

      const textToInsert =
        item.type === 'tag'
          ? (item.tag?.content ?? '')
          : item.type === 'file'
            ? (item.file?.path ?? '')
            : item.task
              ? `task with task_id ${item.task.id}`
              : '';

      const before = value.slice(0, activeQuery.start);
      const after = value.slice(activeQuery.end);
      const nextValue = `${before}${textToInsert}${after}`;
      onChange(nextValue);
      setIsOpen(false);
      setOptions([]);
      setSelectedIndex(-1);
      setActiveQuery(null);

      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const nextCursor = before.length + textToInsert.length;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [activeQuery, onChange, value]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((isOpen || activeQuery) && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        setActiveQuery(null);
        setOptions([]);
        setSelectedIndex(-1);
        return;
      }

      if (isOpen && options.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && selectedIndex >= 0) {
          e.preventDefault();
          insertSelection(options[selectedIndex]);
          return;
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          onShiftCmdEnter?.();
        } else {
          onCmdEnter?.();
        }
        return;
      }

      onKeyDown?.(e);
    },
    [
      activeQuery,
      insertSelection,
      isOpen,
      onCmdEnter,
      onKeyDown,
      onShiftCmdEnter,
      options,
      selectedIndex,
    ]
  );

  const handleSelect = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      insertSelection(option);
    },
    [insertSelection, options]
  );

  const menuStyle = useMemo(() => {
    if (!isOpen || !textareaRef.current) return null;
    const placement = getMenuPosition(textareaRef.current);
    return {
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      minWidth: MIN_WIDTH,
      zIndex: 10000,
      '--typeahead-menu-max-height': `${placement.maxHeight}px`,
    } as CSSProperties;
  }, [isOpen]);

  return (
    <>
      <AutoExpandingTextarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onClick={(e) => updateQueryFromTextarea(e.currentTarget)}
        onSelect={(e) => updateQueryFromTextarea(e.currentTarget)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxRows={maxRows}
        disableInternalScroll={disableInternalScroll}
        className={cn(className)}
      />

      {isOpen && menuStyle &&
        createPortal(
          <div
            className="fixed bg-background border border-border rounded-md shadow-lg overflow-hidden"
            style={menuStyle}
          >
            <div
              className="overflow-y-auto py-1"
              style={{ maxHeight: 'var(--typeahead-menu-max-height)' }}
            >
              {options.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">
                  No tags, files, or tasks found
                </div>
              ) : (
                <>
                  {options.some((o) => o.type === 'tag') && (
                    <>
                      <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                        Tags
                      </div>
                      {options.map((option, index) => {
                        if (option.type !== 'tag' || !option.tag) return null;
                        const tag = option.tag;
                        return (
                          <button
                            key={`tag-${tag.id}`}
                            type="button"
                            ref={(el) => {
                              if (el) itemRefs.current.set(index, el);
                              else itemRefs.current.delete(index);
                            }}
                            className={cn(
                              'w-full text-left px-3 py-2 cursor-pointer text-sm',
                              index === selectedIndex
                                ? 'bg-muted text-foreground'
                                : 'hover:bg-muted'
                            )}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelect(index)}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <TagIcon className="h-3.5 w-3.5 text-blue-600" />
                              <span>@{tag.tag_name}</span>
                            </div>
                            {tag.content && (
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                {tag.content.slice(0, 60)}
                                {tag.content.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {options.some((o) => o.type === 'task') && (
                    <>
                      {options.some((o) => o.type === 'tag') && (
                        <div className="border-t my-1" />
                      )}
                      <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                        Tasks
                      </div>
                      {options.map((option, index) => {
                        if (option.type !== 'task' || !option.task) return null;
                        const task = option.task;
                        return (
                          <button
                            key={`task-${task.id}`}
                            type="button"
                            ref={(el) => {
                              if (el) itemRefs.current.set(index, el);
                              else itemRefs.current.delete(index);
                            }}
                            className={cn(
                              'w-full text-left px-3 py-2 cursor-pointer text-sm',
                              index === selectedIndex
                                ? 'bg-muted text-foreground'
                                : 'hover:bg-muted'
                            )}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelect(index)}
                          >
                            <div className="flex items-center gap-2 font-medium truncate">
                              <List className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              @{task.title}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {options.some((o) => o.type === 'file') && (
                    <>
                      {options.some(
                        (o) => o.type === 'tag' || o.type === 'task'
                      ) && <div className="border-t my-1" />}
                      <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                        Files
                      </div>
                      {options.map((option, index) => {
                        if (option.type !== 'file' || !option.file) return null;
                        const file = option.file;
                        return (
                          <button
                            key={`file-${file.path}`}
                            type="button"
                            ref={(el) => {
                              if (el) itemRefs.current.set(index, el);
                              else itemRefs.current.delete(index);
                            }}
                            className={cn(
                              'w-full text-left px-3 py-2 cursor-pointer text-sm',
                              index === selectedIndex
                                ? 'bg-muted text-foreground'
                                : 'hover:bg-muted'
                            )}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelect(index)}
                          >
                            <div className="flex items-center gap-2 font-medium truncate">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                              <span>{file.name}</span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {file.path}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
