import { SplitSide } from '@git-diff-view/react';
import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
} from 'react';
import type { DraftReviewCommentData } from 'shared/types';
import {
  readFollowUpDraftScratch,
  writeFollowUpDraftScratch,
} from '@/lib/followUpDraftScratch';
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
  drafts: Record<string, ReviewDraft>;
  addComment: (comment: Omit<ReviewComment, 'id'>) => void;
  updateComment: (id: string, text: string) => void;
  deleteComment: (id: string) => void;
  clearComments: () => void;
  setDraft: (key: string, draft: ReviewDraft | null) => void;
  generateReviewMarkdown: () => string;
}

const ReviewContext = createContext<ReviewContextType | null>(null);

function deserializeSplitSide(side: string): SplitSide {
  return side === 'old' ? SplitSide.old : SplitSide.new;
}

function serializeSplitSide(side: SplitSide): string {
  return side === SplitSide.old ? 'old' : 'new';
}

function makeDraftKey(filePath: string, side: SplitSide, lineNumber: number) {
  return `${filePath}-${side}-${lineNumber}`;
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
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});

  useEffect(() => {
    setDrafts({});
  }, [attemptId]);

  useEffect(() => {
    if (!attemptId) {
      setComments([]);
      setDrafts({});
      return;
    }

    const draft = readFollowUpDraftScratch(attemptId);
    const nextComments =
      draft?.review_comments.map((comment) => ({
        id: genId(),
        filePath: comment.file_path,
        lineNumber: comment.line_number,
        side: deserializeSplitSide(comment.side),
        text: comment.text,
        ...(comment.code_line ? { codeLine: comment.code_line } : {}),
      })) ?? [];
    const nextDrafts = Object.fromEntries(
      (draft?.review_comment_drafts ?? []).map((comment) => {
        const side = deserializeSplitSide(comment.side);
        const key = makeDraftKey(comment.file_path, side, comment.line_number);
        return [
          key,
          {
            filePath: comment.file_path,
            lineNumber: comment.line_number,
            side,
            text: comment.text,
            ...(comment.code_line ? { codeLine: comment.code_line } : {}),
          } satisfies ReviewDraft,
        ];
      })
    );

    setComments(nextComments);
    setDrafts(nextDrafts);
  }, [attemptId]);

  useEffect(() => {
    if (!attemptId || typeof window === 'undefined') return;

    try {
      const existing = readFollowUpDraftScratch(attemptId);
      writeFollowUpDraftScratch(attemptId, {
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
        review_comment_drafts: Object.values(drafts).map(
          (draft): DraftReviewCommentData => ({
            file_path: draft.filePath,
            line_number: draft.lineNumber,
            side: serializeSplitSide(draft.side),
            text: draft.text,
            code_line: draft.codeLine ?? null,
          })
        ),
      });
    } catch (error) {
      console.error(
        'Failed to persist review comments and drafts to draft scratch',
        error
      );
    }
  }, [attemptId, comments, drafts]);

  const addComment = (comment: Omit<ReviewComment, 'id'>) => {
    const newComment: ReviewComment = {
      ...comment,
      id: genId(),
    };
    setComments((prev) => [...prev, newComment]);
  };

  const updateComment = (id: string, text: string) => {
    setComments((prev) =>
      prev.map((comment) =>
        comment.id === id ? { ...comment, text } : comment
      )
    );
  };

  const deleteComment = (id: string) => {
    setComments((prev) => prev.filter((comment) => comment.id !== id));
  };

  const clearComments = () => {
    setComments([]);
    setDrafts({});
  };

  const setDraft = (key: string, draft: ReviewDraft | null) => {
    setDrafts((prev) => {
      if (draft === null) {
        const newDrafts = { ...prev };
        delete newDrafts[key];
        return newDrafts;
      }
      return { ...prev, [key]: draft };
    });
  };

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

  return (
    <ReviewContext.Provider
      value={{
        comments,
        drafts,
        addComment,
        updateComment,
        deleteComment,
        clearComments,
        setDraft,
        generateReviewMarkdown,
      }}
    >
      {children}
    </ReviewContext.Provider>
  );
}
