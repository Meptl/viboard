import { Columns, FileText, Pilcrow, WrapText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useDiffViewMode,
  useDiffViewStore,
  useIgnoreWhitespaceDiff,
  useWrapTextDiff,
} from '@/stores/useDiffViewStore';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = {
  className?: string;
};

export default function DiffViewSwitch({ className }: Props) {
  const mode = useDiffViewMode();
  const setMode = useDiffViewStore((s) => s.setMode);
  const ignoreWhitespace = useIgnoreWhitespaceDiff();
  const setIgnoreWhitespace = useDiffViewStore((s) => s.setIgnoreWhitespace);
  const wrapText = useWrapTextDiff();
  const setWrapText = useDiffViewStore((s) => s.setWrapText);

  const whitespaceValue = ignoreWhitespace ? ['ignoreWhitespace'] : [];
  const wrapTextValue = wrapText ? ['wrapText'] : [];

  return (
    <TooltipProvider>
      <div className={cn('inline-flex gap-4', className)}>
        <ToggleGroup
          type="single"
          value={mode ?? ''}
          onValueChange={(v) => v && setMode(v as 'unified' | 'split')}
          className="inline-flex gap-4"
          aria-label="Diff view mode"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="unified"
                aria-label="Inline view"
                active={mode === 'unified'}
              >
                <FileText className="h-4 w-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">Inline view</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="split"
                aria-label="Split view"
                active={mode === 'split'}
              >
                <Columns className="h-4 w-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">Split view</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        <ToggleGroup
          type="multiple"
          value={whitespaceValue}
          onValueChange={(values) =>
            setIgnoreWhitespace(values.includes('ignoreWhitespace'))
          }
          className="inline-flex gap-4"
          aria-label="Ignore whitespace changes"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="ignoreWhitespace"
                aria-label="Ignore whitespace changes"
                active={ignoreWhitespace}
              >
                <Pilcrow className="h-4 w-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Ignore whitespace changes
            </TooltipContent>
          </Tooltip>
        </ToggleGroup>

        <ToggleGroup
          type="multiple"
          value={wrapTextValue}
          onValueChange={(values) => setWrapText(values.includes('wrapText'))}
          className="inline-flex gap-4"
          aria-label="Wrap text"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="wrapText"
                aria-label="Wrap text"
                active={wrapText}
              >
                <WrapText className="h-4 w-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="bottom">Wrap text</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </div>
    </TooltipProvider>
  );
}
