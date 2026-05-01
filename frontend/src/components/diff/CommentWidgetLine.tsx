import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { PlainTextTagTextarea } from '@/components/ui/plain-text-tag-textarea';
import { useReview, type ReviewDraft } from '@/contexts/ReviewProvider';
import { Scope, useKeyExit, useKeySubmitComment } from '@/keyboard';
import { useHotkeysContext } from 'react-hotkeys-hook';

interface CommentWidgetLineProps {
  draft: ReviewDraft;
  widgetKey: string;
  setDraft: (key: string, draft: ReviewDraft | null) => void;
  onSave: () => void;
  onCancel: () => void;
  projectId?: string;
}

export function CommentWidgetLine({
  draft,
  widgetKey,
  setDraft,
  onSave,
  onCancel,
  projectId,
}: CommentWidgetLineProps) {
  const { addComment } = useReview();
  const [value, setValue] = useState(draft.text);
  const latestValueRef = useRef(draft.text);
  const didCompleteRef = useRef(false);
  const { enableScope, disableScope } = useHotkeysContext();

  useEffect(() => {
    setValue(draft.text);
    latestValueRef.current = draft.text;
  }, [draft.text]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    enableScope(Scope.EDIT_COMMENT);
    return () => {
      disableScope(Scope.EDIT_COMMENT);
    };
  }, [enableScope, disableScope]);

  const handleCancel = useCallback(() => {
    didCompleteRef.current = true;
    setDraft(widgetKey, null);
    onCancel();
  }, [setDraft, widgetKey, onCancel]);

  const handleSave = useCallback(() => {
    didCompleteRef.current = true;
    if (value.trim()) {
      addComment({
        filePath: draft.filePath,
        side: draft.side,
        lineNumber: draft.lineNumber,
        text: value.trim(),
        codeLine: draft.codeLine,
      });
    }
    setDraft(widgetKey, null);
    onSave();
  }, [value, draft, setDraft, widgetKey, onSave, addComment]);

  const handleSubmitShortcut = useCallback(
    (e?: KeyboardEvent) => {
      e?.preventDefault();
      handleSave();
    },
    [handleSave]
  );

  const exitOptions = useMemo(
    () => ({
      scope: Scope.EDIT_COMMENT,
    }),
    []
  );

  useKeyExit(handleCancel, exitOptions);

  useKeySubmitComment(handleSubmitShortcut, {
    scope: Scope.EDIT_COMMENT,
    enableOnFormTags: ['textarea', 'TEXTAREA'],
    when: value.trim() !== '',
    preventDefault: true,
  });

  const handleChange = useCallback((nextValue: string) => {
    setValue(nextValue);
  }, []);

  useEffect(() => {
    return () => {
      if (didCompleteRef.current) return;
      setDraft(widgetKey, { ...draft, text: latestValueRef.current });
    };
  }, [draft, setDraft, widgetKey]);

  return (
    <div className="p-4 border-y bg-primary">
      <PlainTextTagTextarea
        value={value}
        onChange={handleChange}
        placeholder="Add a comment... (type @ to search files or tasks)"
        className="w-full bg-primary text-primary-foreground text-sm font-mono min-h-[80px] border rounded-md p-3"
        projectId={projectId}
        onCmdEnter={handleSave}
        autoFocus
        maxRows={8}
      />
      <div className="mt-2 flex gap-2">
        <Button size="xs" onClick={handleSave} disabled={!value.trim()}>
          Add review comment
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={handleCancel}
          className="text-secondary-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
