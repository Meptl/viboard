import type { FocusEventHandler } from 'react';
import { MultiFileSearchTextarea } from '@/components/ui/multi-file-search-textarea';

interface CopyFilesFieldProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  projectId: string;
  disabled?: boolean;
}

export function CopyFilesField({
  value,
  onChange,
  onBlur,
  projectId,
  disabled = false,
}: CopyFilesFieldProps) {
  return (
    <MultiFileSearchTextarea
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder="File paths or glob patterns (e.g., .env, config/*.json)"
      rows={3}
      disabled={disabled}
      className="w-full px-3 py-2 text-sm border border-input bg-background text-foreground disabled:opacity-50 rounded-md resize-vertical focus:outline-none focus:ring-2 focus:ring-ring"
      projectId={projectId}
      maxRows={6}
    />
  );
}
