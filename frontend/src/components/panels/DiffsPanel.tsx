import { useDiffStream } from '@/hooks/useDiffStream';
import { useDiffStreamContext } from '@/contexts/DiffStreamContext';
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
import type { TaskAttempt, Diff, DiffMetadata } from 'shared/types';
import type { DraftReviewCommentData } from 'shared/types';
import { attemptsApi, draftApi } from '@/lib/api';
import { SplitSide } from '@git-diff-view/react';
import { useReview, type ReviewDraft } from '@/contexts/ReviewProvider';

interface DiffsPanelProps {
  selectedAttempt: TaskAttempt | null;
}

type LoadedDiffRecord = {
  diff: Diff;
};

type DiffMetadataSignature = {
  change: DiffMetadata['change'];
  oldPath: string | null;
  newPath: string | null;
  contentOmitted: boolean;
};

const COLLAPSE_ALL_DEFAULT_THRESHOLD = 100;
const LARGE_FILE_CHANGE_COLLAPSE_THRESHOLD = 400;
const DEFAULT_COLLAPSED_CHANGES = new Set([
  'deleted',
  'renamed',
  'copied',
  'permissionChange',
]);
const EMPTY_DRAFTS_FOR_FILE: Readonly<Record<string, ReviewDraft>> = {};

function serializeSplitSide(side: SplitSide): string {
  return side === SplitSide.old ? 'old' : 'new';
}

function deserializeSplitSide(side: string): SplitSide {
  return side === 'old' ? SplitSide.old : SplitSide.new;
}

function getDiffFilePath(diff: DiffMetadata): string {
  return diff.newPath || diff.oldPath || 'unknown';
}

function isLargeDiffFile(diff: DiffMetadata): boolean {
  const additions = diff.additions ?? 0;
  const deletions = diff.deletions ?? 0;
  return additions + deletions > LARGE_FILE_CHANGE_COLLAPSE_THRESHOLD;
}

function getDiffId(diff: DiffMetadata, idx: number): string {
  if (diff.change === 'deleted') {
    return diff.oldPath || diff.newPath || String(idx);
  }
  if (diff.change === 'added') {
    return diff.newPath || diff.oldPath || String(idx);
  }
  return diff.newPath || diff.oldPath || String(idx);
}

function metadataToDisplayDiff(metadata: DiffMetadata): Diff {
  return {
    ...metadata,
    oldContent: null,
    newContent: null,
  };
}

export function DiffsPanel({ selectedAttempt }: DiffsPanelProps) {
  const { t } = useTranslation('tasks');
  const { comments } = useReview();
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
  const [draftsByFile, setDraftsByFile] = useState<
    Record<string, Record<string, ReviewDraft>>
  >({});
  const loadedDraftAttemptIdRef = useRef<string | null>(null);
  const [hasCompletedFirstPageLoad, setHasCompletedFirstPageLoad] = useState(false);
  const previousMetadataByIdRef = useRef<Record<string, DiffMetadataSignature>>(
    {}
  );

  // @lat: [[lazy-diff-loading#Metadata-First Diff Stream]]
  const diffStreamContext = useDiffStreamContext();
  const fallbackDiffStream = useDiffStream(
    selectedAttempt?.id ?? null,
    !diffStreamContext
  );
  const { diffs: metadataDiffs, isComplete, error } =
    diffStreamContext ?? fallbackDiffStream;
  const loading =
    !!selectedAttempt &&
    !hasCompletedFirstPageLoad &&
    !error &&
    !isComplete &&
    metadataDiffs.length === 0;

  const mergedDiffs = useMemo(() => {
    return metadataDiffs.map((diff, idx) => {
      const id = getDiffId(diff, idx);
      const loaded = loadedDiffs[id];
      if (!loaded) {
        return metadataToDisplayDiff(diff);
      }
      return loaded.diff;
    });
  }, [metadataDiffs, loadedDiffs]);

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
    setDraftsByFile({});
    loadedDraftAttemptIdRef.current = null;
    previousMetadataByIdRef.current = {};
  }, [selectedAttempt?.id]);

  useEffect(() => {
    if (
      !hasCompletedFirstPageLoad &&
      (isComplete || !!error || metadataDiffs.length > 0)
    ) {
      setHasCompletedFirstPageLoad(true);
    }
  }, [metadataDiffs.length, error, hasCompletedFirstPageLoad, isComplete]);

  useEffect(() => {
    const nextMetadataById: Record<string, DiffMetadataSignature> = {};
    const invalidatedIds = new Set<string>();
    const previousMetadataById = previousMetadataByIdRef.current;

    metadataDiffs.forEach((diff, idx) => {
      const id = getDiffId(diff, idx);
      const signature: DiffMetadataSignature = {
        change: diff.change,
        oldPath: diff.oldPath ?? null,
        newPath: diff.newPath ?? null,
        contentOmitted: !!diff.contentOmitted,
      };
      nextMetadataById[id] = signature;

      const previous = previousMetadataById[id];
      if (!previous) return;
      if (
        previous.change !== signature.change ||
        previous.oldPath !== signature.oldPath ||
        previous.newPath !== signature.newPath ||
        previous.contentOmitted !== signature.contentOmitted
      ) {
        invalidatedIds.add(id);
      }
    });

    previousMetadataByIdRef.current = nextMetadataById;
    if (invalidatedIds.size === 0) return;

    setLoadedDiffs((prev) => {
      let changed = false;
      const next: Record<string, LoadedDiffRecord> = {};
      for (const [id, loaded] of Object.entries(prev)) {
        if (invalidatedIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = loaded;
      }
      return changed ? next : prev;
    });
    setLoadingIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (invalidatedIds.has(id)) {
          changed = true;
          return;
        }
        next.add(id);
      });
      return changed ? next : prev;
    });
    setProcessedStatsIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (invalidatedIds.has(id)) {
          changed = true;
          return;
        }
        next.add(id);
      });
      return changed ? next : prev;
    });
  }, [metadataDiffs]);

  useEffect(() => {
    const attemptId = selectedAttempt?.id;
    if (!attemptId) {
      setDraftsByFile({});
      loadedDraftAttemptIdRef.current = null;
      return;
    }

    let mounted = true;
    draftApi
      .get(attemptId)
      .then((draft) => {
        if (!mounted) return;
        const nextDraftsByFile: Record<string, Record<string, ReviewDraft>> = {};
        for (const comment of draft?.review_comment_drafts ?? []) {
          const side = deserializeSplitSide(comment.side);
          const filePath = comment.file_path;
          const key = `${filePath}-${side}-${comment.line_number}`;
          const nextDraft: ReviewDraft = {
            filePath,
            side,
            lineNumber: comment.line_number,
            text: comment.text,
            ...(comment.code_line ? { codeLine: comment.code_line } : {}),
          };
          if (!nextDraftsByFile[filePath]) {
            nextDraftsByFile[filePath] = {};
          }
          nextDraftsByFile[filePath][key] = nextDraft;
        }
        setDraftsByFile(nextDraftsByFile);
        loadedDraftAttemptIdRef.current = attemptId;
      })
      .catch((error) => {
        console.error('Failed to load review comment drafts', error);
        if (!mounted) return;
        setDraftsByFile({});
        loadedDraftAttemptIdRef.current = attemptId;
      });

    return () => {
      mounted = false;
    };
  }, [selectedAttempt?.id]);

  const setDraftForFile = useCallback(
    (filePath: string, key: string, draft: ReviewDraft | null) => {
      setDraftsByFile((prev) => {
        const prevFileDrafts = prev[filePath] ?? EMPTY_DRAFTS_FOR_FILE;
        if (draft === null) {
          if (!(key in prevFileDrafts)) return prev;
          const nextFileDrafts = { ...prevFileDrafts };
          delete nextFileDrafts[key];
          if (Object.keys(nextFileDrafts).length === 0) {
            const next = { ...prev };
            delete next[filePath];
            return next;
          }
          return { ...prev, [filePath]: nextFileDrafts };
        }

        const previous = prevFileDrafts[key];
        if (
          previous &&
          previous.text === draft.text &&
          previous.codeLine === draft.codeLine
        ) {
          return prev;
        }

        return {
          ...prev,
          [filePath]: {
            ...prevFileDrafts,
            [key]: draft,
          },
        };
      });
    },
    []
  );

  useEffect(() => {
    const attemptId = selectedAttempt?.id;
    if (!attemptId) return;
    if (loadedDraftAttemptIdRef.current !== attemptId) return;

    const saveTimeout = window.setTimeout(() => {
      const reviewCommentDrafts: DraftReviewCommentData[] = Object.values(
        draftsByFile
      )
        .flatMap((fileDrafts) => Object.values(fileDrafts))
        .map((draft) => ({
          file_path: draft.filePath,
          line_number: draft.lineNumber,
          side: serializeSplitSide(draft.side),
          text: draft.text,
          code_line: draft.codeLine ?? null,
        }));

      void draftApi
        .get(attemptId)
        .then((existing) =>
          draftApi.save(attemptId, {
            message: existing?.message ?? '',
            variant: existing?.variant ?? null,
            review_comments: comments.map((comment) => ({
              file_path: comment.filePath,
              line_number: comment.lineNumber,
              side: serializeSplitSide(comment.side),
              text: comment.text,
              code_line: comment.codeLine ?? null,
            })),
            review_comment_drafts: reviewCommentDrafts,
          })
        )
        .catch((error) => {
          console.error('Failed to persist review comment drafts', error);
        });
    }, 400);

    return () => {
      window.clearTimeout(saveTimeout);
    };
  }, [selectedAttempt?.id, comments, draftsByFile]);

  useEffect(() => {
    if (
      !isComplete ||
      metadataDiffs.length === 0 ||
      hasInitialized ||
      hasUserAdjustedCollapse
    )
      return;

    const initial =
      metadataDiffs.length > COLLAPSE_ALL_DEFAULT_THRESHOLD
        ? new Set(metadataDiffs.map((d, i) => getDiffId(d, i)))
        : new Set(
            metadataDiffs
              .filter(
                (d) =>
                  DEFAULT_COLLAPSED_CHANGES.has(d.change) ||
                  d.contentOmitted ||
                  isLargeDiffFile(d)
              )
              .map((d, i) => getDiffId(d, i))
          );

    if (initial.size > 0) {
      setCollapsedIds(initial);
    }
    setHasInitialized(true);
  }, [metadataDiffs, hasInitialized, hasUserAdjustedCollapse, isComplete]);

  useEffect(() => {
    const validIds = new Set(
      metadataDiffs.map((diff, idx) => getDiffId(diff, idx))
    );
    setLoadedDiffs((prev) => {
      const next: Record<string, LoadedDiffRecord> = {};
      for (const [id, loaded] of Object.entries(prev)) {
        if (!validIds.has(id)) {
          continue;
        }
        next[id] = loaded;
      }
      return next;
    });
  }, [metadataDiffs]);

  useEffect(() => {
    const validIds = new Set(
      metadataDiffs.map((diff, idx) => getDiffId(diff, idx))
    );
    setProcessedStatsIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [metadataDiffs]);

  const ids = useMemo(() => {
    return mergedDiffs.map((d, i) => getDiffId(d, i));
  }, [mergedDiffs]);

  const largeDiffIds = useMemo(
    () =>
      new Set(
        mergedDiffs
          .map((diff, idx) => ({ id: getDiffId(diff, idx), diff }))
          .filter(({ diff }) => isLargeDiffFile(diff))
          .map(({ id }) => id)
      ),
    [mergedDiffs]
  );

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
    setCollapsedIds(allCollapsed ? new Set(largeDiffIds) : new Set(ids));
  }, [allCollapsed, ids, largeDiffIds]);

  // @lat: [[lazy-diff-loading#On-Demand File Content Fetch]]
  const ensureDiffContentLoaded = useCallback(
    async (id: string, diff: Diff) => {
      const attemptId = selectedAttempt?.id;
      const path = diff.newPath || diff.oldPath;
      if (!attemptId || !path) return;

      if (loadedDiffs[id]) return;
      if (loadingIds.has(id)) return;
      if (processedStatsIds.has(id)) return;

      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      try {
        const startedAt = performance.now();
        const fullDiff = await attemptsApi.getDiffFile(attemptId, path);
        const normalizedDiff: Diff = {
          ...fullDiff,
          oldPath: diff.oldPath,
          newPath: diff.newPath,
          change: diff.change,
        };
        const fetchMs = performance.now() - startedAt;
        if (fetchMs > 150) {
          console.debug(
            `[diff-timing] fetched ${path} in ${fetchMs.toFixed(1)}ms`
          );
        }
        setLoadedDiffs((prev) => ({
          ...prev,
          [id]: {
            diff: normalizedDiff,
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
    [selectedAttempt?.id, loadedDiffs, loadingIds, processedStatsIds]
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
      draftsByFile={draftsByFile}
      setDraftForFile={setDraftForFile}
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
  draftsByFile: Record<string, Record<string, ReviewDraft>>;
  setDraftForFile: (
    filePath: string,
    key: string,
    draft: ReviewDraft | null
  ) => void;
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
  draftsByFile,
  setDraftForFile,
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
            const filePath = getDiffFilePath(diff);
            return (
              <ViewportAwareRow
                key={id}
                id={id}
                rootRef={listRootRef}
                visibilityKey={`${isExpanded}:${diff.change}:${diff.oldPath ?? ''}:${diff.newPath ?? ''}:${diff.additions ?? ''}:${diff.deletions ?? ''}:${diff.contentOmitted ? '1' : '0'}`}
                onVisible={() => {
                  if (!isExpanded) return;
                  void ensureDiffContentLoaded(id, diff);
                }}
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
                  draftsForFile={draftsByFile[filePath] ?? EMPTY_DRAFTS_FOR_FILE}
                  setDraftForFile={setDraftForFile}
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
  visibilityKey,
  onVisible,
  children,
}: {
  id: string;
  rootRef: RefObject<HTMLDivElement | null>;
  visibilityKey: string;
  onVisible: () => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        isIntersectingRef.current = isIntersecting;
        if (isIntersecting) {
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

  useEffect(() => {
    if (!isIntersectingRef.current) return;
    onVisibleRef.current();
  }, [visibilityKey]);

  return <div ref={rowRef}>{children}</div>;
}
