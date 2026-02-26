import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Copy, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NewCardHeader } from '@/components/ui/new-card';

interface PreviewToolbarProps {
  mode: 'noServer' | 'error' | 'ready';
  url?: string;
  onRefresh: () => void;
  onCopyUrl: () => void;
  onStop: () => void;
  onNavigate?: (url: string) => void;
  isStopping?: boolean;
}

export function PreviewToolbar({
  mode,
  url,
  onRefresh,
  onCopyUrl,
  onStop,
  onNavigate,
  isStopping,
}: PreviewToolbarProps) {
  const { t } = useTranslation('tasks');
  const [draftUrl, setDraftUrl] = useState(url ?? '');

  useEffect(() => {
    setDraftUrl(url ?? '');
  }, [url]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextUrl = draftUrl.trim();
    if (!nextUrl) {
      setDraftUrl(url ?? '');
      return;
    }
    onNavigate?.(nextUrl);
  };

  const actions =
    mode !== 'noServer' ? (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="icon"
                aria-label={t('preview.toolbar.refresh')}
                onClick={onRefresh}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('preview.toolbar.refresh')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="icon"
                aria-label={t('preview.toolbar.copyUrl')}
                onClick={onCopyUrl}
                disabled={!url}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('preview.toolbar.copyUrl')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="icon"
                aria-label={t('preview.toolbar.openInTab')}
                asChild
                disabled={!url}
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('preview.toolbar.openInTab')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-4 w-px bg-border" />

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="icon"
                aria-label={t('preview.toolbar.stopDevServer')}
                onClick={onStop}
                disabled={isStopping}
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 text-destructive" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('preview.toolbar.stopDevServer')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    ) : undefined;

  return (
    <NewCardHeader className="shrink-0" actions={actions}>
      <form onSubmit={handleSubmit} className="flex items-center w-full">
        {url ? (
          <Input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            className="h-8 font-mono text-xs rounded-sm"
            aria-label={t('preview.toolbar.openInTab')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        ) : (
          <div
            className="text-muted-foreground flex items-center"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </form>
    </NewCardHeader>
  );
}
