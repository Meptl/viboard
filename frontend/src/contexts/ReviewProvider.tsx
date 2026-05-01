import { SplitSide } from '@git-diff-view/react';
import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { DraftReviewCommentData } from 'shared/types';
import { draftApi } from '@/lib/api';
import { genId } from '@/utils/id';

export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  side: SplitSide;
  text: string;
  codeLine?: string;
}

export interface ReviewDraft {
  filePath: string;
  side: SplitSide;
  lineNumber: number;
  text: string;
  codeLine?: string;
}

interface ReviewContextType {
  comments: ReviewComment[];
  addComment: (comment: Omit<ReviewComment, 'id'>) => void;
  updateComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  clearComments: () => void;
  generateReviewMarkdown: () => string;
}

const ReviewContext = createContext<ReviewContextType | null>(null);

function deserializeSplitSide(side: string): SplitSide {
  return side === 'old' ? SplitSide.old : SplitSide.new;
}

function serializeSplitSide(side: SplitSide): string {
  return side === SplitSide.old ? 'old' : 'new';
}

export function useReview() {
  const context = useContext(ReviewContext);
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider');
  }
  return context;
}

export function ReviewProvider({
  children,
  attemptId,
}: {
  children: ReactNode;
  attemptId?: string;
}) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const loadedAttemptIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!attemptId) {
      setComments([]);
      loadedAttemptIdRef.current = null;
      return;
    }

    let mounted = true;
    draftApi
      .get(attemptId)
      .then((draft) => {
        if (!mounted) return;
        const nextComments =
          draft?.review_comments.map((comment) => ({
            id: genId(),
            filePath: comment.file_path,
            lineNumber: comment.line_number,
            side: deserializeSplitSide(comment.side),
            text: comment.text,
            ...(comment.code_line ? { codeLine: comment.code_line } : {}),
          })) ?? [];
        setComments(nextComments);
        loadedAttemptIdRef.current = attemptId;
      })
      .catch((error) => {
        console.error('Failed to load review drafts', error);
        if (!mounted) return;
        setComments([]);
        loadedAttemptIdRef.current = attemptId;
      });

    return () => {
      mounted = false;
    };
  }, [attemptId]);

  useEffect(() => {
    if (!attemptId) return;
    if (loadedAttemptIdRef.current !== attemptId) return;

    const saveTimeout = window.setTimeout(() => {
      void draftApi
        .get(attemptId)
        .then((existing) =>
          draftApi.save(attemptId, {
            message: existing?.message ?? '',
            variant: existing?.variant ?? null,
            review_comments: comments.map(
              (comment): DraftReviewCommentData => ({
                file_path: comment.filePath,
                line_number: comment.lineNumber,
                side: serializeSplitSide(comment.side),
                text: comment.text,
                code_line: comment.codeLine ?? null,
              })
            ),
            review_comment_drafts: existing?.review_comment_drafts ?? [],
          })
        )
        .catch((error) => {
          console.error('Failed to persist review comments and drafts', error);
        });
    }, 400);

    return () => {
      window.clearTimeout(saveTimeout);
    };
  }, [attemptId, comments]);

  const addComment = useCallback((comment: Omit<ReviewComment, 'id'>) => {
    const newComment: ReviewComment = {
      ...comment,
      id: genId(),
    };
    setComments((prev) => [...prev, newComment]);
  }, []);

  const updateComment = useCallback((id: string, text: string) => {
    setComments((prev) =>
      prev.map((comment) =>
        comment.id === id ? { ...comment, text } : comment
      )
    );
  }, []);

  const deleteComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((comment) => comment.id !== id));
  }, []);

  const clearComments = useCallback(() => {
    setComments([]);
  }, []);

  const generateReviewMarkdown = useCallback(() => {
    if (comments.length === 0) return '';

    const commentsNum = comments.length;

    const header = `## Review Comments (${commentsNum})\n\n`;
    const formatCodeLine = (line?: string) => {
      if (!line) return '';
      if (line.includes('`')) {
        return `\`\`\`\n${line}\n\`\`\``;
      }
      return `\`${line}\``;
    };

    const commentsMd = comments
      .map((comment) => {
        const codeLine = formatCodeLine(comment.codeLine);
        // Format file paths in comment body with backticks
        const bodyWithFormattedPaths = comment.text
          .trim()
          .replace(/([/\\]?[\w.-]+(?:[/\\][\w.-]+)+)/g, '`$1`');
        if (codeLine) {
          return `**${comment.filePath}** (Line ${comment.lineNumber})\n${codeLine}\n\n> ${bodyWithFormattedPaths}\n`;
        }
        return `**${comment.filePath}** (Line ${comment.lineNumber})\n\n> ${bodyWithFormattedPaths}\n`;
      })
      .join('\n');

    return header + commentsMd;
  }, [comments]);

  const value = useMemo(
    () => ({
      comments,
      addComment,
      updateComment,
      deleteComment,
      clearComments,
      generateReviewMarkdown,
    }),
    [
      comments,
      addComment,
      updateComment,
      deleteComment,
      clearComments,
      generateReviewMarkdown,
    ]
  );

  return (
    <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
  );
}
