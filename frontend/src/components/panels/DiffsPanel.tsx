import { useDiffStream } from '@/hooks/useDiffStream';
import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  type RefObject,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Loader } from '@/components/ui/loader';
import { Button } from '@/components/ui/button';
import DiffViewSwitch from '@/components/DiffViewSwitch';
import DiffCard from '@/components/DiffCard';
import { NewCardHeader } from '@/components/ui/new-card';
import { ChevronsUp, ChevronsDown, AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TaskAttempt, Diff } from 'shared/types';
import { attemptsApi } from '@/lib/api';

interface DiffsPanelProps {
  selectedAttempt: TaskAttempt | null;
}

type LoadedDiffRecord = {
  diff: Diff;
  signature: string;
};

const COLLAPSE_ALL_DEFAULT_THRESHOLD = 100;
const DEFAULT_COLLAPSED_CHANGES = new Set([
  'deleted',
  'renamed',
  'copied',
  'permissionChange',
]);

function getDiffId(diff: Diff, idx: number): string {
  return diff.newPath || diff.oldPath || String(idx);
}

function getDiffSignature(diff: Diff): string {
  return [
    diff.change,
    diff.oldPath || '',
    diff.newPath || '',
    diff.additions ?? 'na',
    diff.deletions ?? 'na',
    diff.contentOmitted ? '1' : '0',
  ].join('|');
}

export function DiffsPanel({ selectedAttempt }: DiffsPanelProps) {
  const { t } = useTranslation('tasks');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  const [hasUserAdjustedCollapse, setHasUserAdjustedCollapse] = useState(false);
  const [loadedDiffs, setLoadedDiffs] = useState<Record<string, LoadedDiffRecord>>(
    {}
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [processedStatsIds, setProcessedStatsIds] = useState<Set<string>>(
    new Set()
  );

  // @lat: [[lazy-diff-loading#Metadata-First Diff Stream]]
  const { diffs, isComplete, error } = useDiffStream(
    selectedAttempt?.id ?? null,
    true
  );
  const loading = !!selectedAttempt && !isComplete && !error;

  const metadataSignatures = useMemo(() => {
    const map = new Map<string, string>();
    diffs.forEach((diff, idx) => {
      map.set(getDiffId(diff, idx), getDiffSignature(diff));
    });
    return map;
  }, [diffs]);

  const mergedDiffs = useMemo(() => {
    return diffs.map((diff, idx) => {
      const id = getDiffId(diff, idx);
      const loaded = loadedDiffs[id];
      const currentSig = metadataSignatures.get(id);
      if (!loaded || loaded.signature !== currentSig) {
        return diff;
      }
      return loaded.diff;
    });
  }, [diffs, loadedDiffs, metadataSignatures]);

  const { fileCount, added, deleted } = useMemo(() => {
    if (mergedDiffs.length === 0) {
      return { fileCount: 0, added: 0, deleted: 0 };
    }

    return mergedDiffs.reduce(
      (acc, d) => {
        acc.added += d.additions ?? 0;
        acc.deleted += d.deletions ?? 0;
        return acc;
      },
      { fileCount: mergedDiffs.length, added: 0, deleted: 0 }
    );
  }, [mergedDiffs]);

  useEffect(() => {
    setHasInitialized(false);
    setHasUserAdjustedCollapse(false);
    setLoadedDiffs({});
    setLoadingIds(new Set());
    setProcessedStatsIds(new Set());
  }, [selectedAttempt?.id]);

  useEffect(() => {
    if (!isComplete || diffs.length === 0 || hasInitialized || hasUserAdjustedCollapse)
      return;

    const initial =
      diffs.length > COLLAPSE_ALL_DEFAULT_THRESHOLD
        ? new Set(diffs.map((d, i) => getDiffId(d, i)))
        : new Set(
            diffs
              .filter((d) => DEFAULT_COLLAPSED_CHANGES.has(d.change))
              .map((d, i) => getDiffId(d, i))
          );

    if (initial.size > 0) {
      setCollapsedIds(initial);
    }
    setHasInitialized(true);
  }, [diffs, hasInitialized, hasUserAdjustedCollapse, isComplete]);

  useEffect(() => {
    const validIds = new Set(diffs.map((diff, idx) => getDiffId(diff, idx)));
    setLoadedDiffs((prev) => {
      const next: Record<string, LoadedDiffRecord> = {};
      for (const [id, loaded] of Object.entries(prev)) {
        const signature = metadataSignatures.get(id);
        if (!validIds.has(id) || signature !== loaded.signature) {
          continue;
        }
        next[id] = loaded;
      }
      return next;
    });
  }, [diffs, metadataSignatures]);

  useEffect(() => {
    const validIds = new Set(diffs.map((diff, idx) => getDiffId(diff, idx)));
    setProcessedStatsIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [diffs]);

  const ids = useMemo(() => {
    return mergedDiffs.map((d, i) => getDiffId(d, i));
  }, [mergedDiffs]);

  const toggle = useCallback((id: string) => {
    setHasUserAdjustedCollapse(true);
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allCollapsed = collapsedIds.size === mergedDiffs.length;
  const handleCollapseAll = useCallback(() => {
    setHasUserAdjustedCollapse(true);
    setCollapsedIds(allCollapsed ? new Set() : new Set(ids));
  }, [allCollapsed, ids]);

  // @lat: [[lazy-diff-loading#On-Demand File Content Fetch]]
  const ensureDiffContentLoaded = useCallback(
    async (id: string, diff: Diff) => {
      const attemptId = selectedAttempt?.id;
      const path = diff.newPath || diff.oldPath;
      if (!attemptId || !path) return;

      const signature = metadataSignatures.get(id);
      if (!signature) return;
      if (loadedDiffs[id]?.signature === signature) return;
      if (loadingIds.has(id)) return;

      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      try {
        const startedAt = performance.now();
        const fullDiff = await attemptsApi.getDiffFile(attemptId, path);
        const fetchMs = performance.now() - startedAt;
        if (fetchMs > 150) {
          console.debug(
            `[diff-timing] fetched ${path} in ${fetchMs.toFixed(1)}ms`
          );
        }
        setLoadedDiffs((prev) => ({
          ...prev,
          [id]: {
            diff: fullDiff,
            signature,
          },
        }));
      } catch (fetchError) {
        console.error('Failed to load diff file content', path, fetchError);
      } finally {
        setProcessedStatsIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [selectedAttempt?.id, metadataSignatures, loadedDiffs, loadingIds]
  );

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 m-4">
        <div className="text-red-800 text-sm">
          {t('diff.errorLoadingDiff', { error })}
        </div>
      </div>
    );
  }

  return (
    <DiffsPanelContent
      diffs={mergedDiffs}
      fileCount={fileCount}
      added={added}
      deleted={deleted}
      collapsedIds={collapsedIds}
      allCollapsed={allCollapsed}
      handleCollapseAll={handleCollapseAll}
      toggle={toggle}
      selectedAttempt={selectedAttempt}
      loading={loading}
      loadingIds={loadingIds}
      ensureDiffContentLoaded={ensureDiffContentLoaded}
      processedStatsIds={processedStatsIds}
      t={t}
    />
  );
}

interface DiffsPanelContentProps {
  diffs: Diff[];
  fileCount: number;
  added: number;
  deleted: number;
  collapsedIds: Set<string>;
  allCollapsed: boolean;
  handleCollapseAll: () => void;
  toggle: (id: string) => void;
  selectedAttempt: TaskAttempt | null;
  loading: boolean;
  loadingIds: Set<string>;
  ensureDiffContentLoaded: (id: string, diff: Diff) => Promise<void>;
  processedStatsIds: Set<string>;
  t: (key: string, params?: Record<string, unknown>) => string;
}

function DiffsPanelContent({
  diffs,
  fileCount,
  added,
  deleted,
  collapsedIds,
  allCollapsed,
  handleCollapseAll,
  toggle,
  selectedAttempt,
  loading,
  loadingIds,
  ensureDiffContentLoaded,
  processedStatsIds,
  t,
}: DiffsPanelContentProps) {
  const listRootRef = useRef<HTMLDivElement>(null);

  const omittedFileCount = useMemo(
    () => diffs.reduce((count, diff) => count + (diff.contentOmitted ? 1 : 0), 0),
    [diffs]
  );

  return (
    <div className="h-full flex flex-col relative">
      {diffs.length > 0 && (
        <NewCardHeader
          className="sticky top-0 z-10"
          actions={
            <>
              <DiffViewSwitch />
              <div className="h-4 w-px bg-border" />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="icon"
                      onClick={handleCollapseAll}
                      aria-pressed={allCollapsed}
                      aria-label={
                        allCollapsed
                          ? t('diff.expandAll')
                          : t('diff.collapseAll')
                      }
                    >
                      {allCollapsed ? (
                        <ChevronsDown className="h-4 w-4" />
                      ) : (
                        <ChevronsUp className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {allCollapsed ? t('diff.expandAll') : t('diff.collapseAll')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          }
        >
          <div className="flex items-center">
            <span
              className="text-sm text-muted-foreground whitespace-nowrap"
              aria-live="polite"
            >
              {t('diff.filesChanged', { count: fileCount })}{' '}
              <span className="text-green-600 dark:text-green-500">
                +{added}
              </span>{' '}
              <span className="text-red-600 dark:text-red-500">-{deleted}</span>
              {omittedFileCount > 0 && (
                <>
                  {' '}
                  <span className="opacity-50">•</span>{' '}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center align-middle gap-1 leading-none text-warning">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {omittedFileCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {omittedFileCount} file
                        {omittedFileCount === 1 ? '' : 's'} omitted from the
                        streamed diff payload; totals may be incomplete.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </span>
          </div>
        </NewCardHeader>
      )}
      <div ref={listRootRef} className="flex-1 overflow-y-auto px-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader />
          </div>
        ) : diffs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t('diff.noChanges')}
          </div>
        ) : (
          diffs.map((diff, idx) => {
            const id = getDiffId(diff, idx);
            const isExpanded = !collapsedIds.has(id);
            return (
              <ViewportAwareRow
                key={id}
                id={id}
                rootRef={listRootRef}
                onVisible={() => ensureDiffContentLoaded(id, diff)}
              >
                <DiffCard
                  diff={diff}
                  expanded={isExpanded}
                  onToggle={() => {
                    const willExpand = collapsedIds.has(id);
                    toggle(id);
                    if (willExpand) {
                      void ensureDiffContentLoaded(id, diff);
                    }
                  }}
                  selectedAttempt={selectedAttempt}
                  loadingContent={loadingIds.has(id)}
                  statsProcessed={processedStatsIds.has(id)}
                />
              </ViewportAwareRow>
            );
          })
        )}
      </div>
    </div>
  );
}

function ViewportAwareRow({
  id,
  rootRef,
  onVisible,
  children,
}: {
  id: string;
  rootRef: RefObject<HTMLDivElement | null>;
  onVisible: () => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisibleRef.current();
        }
      },
      {
        root: rootRef.current,
        rootMargin: '500px 0px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [id, rootRef]);

  return <div ref={rowRef}>{children}</div>;
}
