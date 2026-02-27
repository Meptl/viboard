import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { useDiffSummary } from '@/hooks/useDiffSummary';
import { useUserSystem } from '@/components/ConfigProvider';
import { useQuery } from '@tanstack/react-query';
import { attemptsApi } from '@/lib/api';
import { BaseAgentCapability } from 'shared/types';

type NextActionCardProps = {
  attemptId?: string;
  containerRef?: string | null;
  failed: boolean;
  execution_processes: number;
  needsSetup?: boolean;
};

export function NextActionCard({
  attemptId,
  failed,
  execution_processes,
  needsSetup,
}: NextActionCardProps) {
  const { t } = useTranslation('tasks');

  const { data: attempt } = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => attemptsApi.get(attemptId!),
    enabled: !!attemptId && failed,
  });
  const { capabilities } = useUserSystem();

  const { fileCount, added, deleted, error } = useDiffSummary(
    attemptId ?? null
  );

  const canAutoSetup = !!(
    attempt?.executor &&
    capabilities?.[attempt.executor]?.includes(BaseAgentCapability.SETUP_HELPER)
  );

  const setupHelpText = canAutoSetup
    ? t('attempt.setupHelpText', { agent: attempt?.executor })
    : null;

  // Necessary to prevent this component being displayed beyond fold within Virtualised List
  if (
    (!failed || (execution_processes > 2 && !needsSetup)) &&
    fileCount === 0
  ) {
    return <div className="h-24"></div>;
  }

  return (
    <div className="pt-4 pb-8">
      <div
        className={`px-3 py-1 text-background flex ${failed ? 'bg-destructive' : 'bg-foreground'}`}
      >
        <span className="font-semibold flex-1">
          {t('attempt.labels.summaryAndActions')}
        </span>
      </div>

      {/* Display setup help text when setup is needed */}
      {needsSetup && setupHelpText && (
        <div
          className={`border-x border-t ${failed ? 'border-destructive' : 'border-foreground'} px-3 py-2 flex items-start gap-2`}
        >
          <Settings className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span className="text-sm">{setupHelpText}</span>
        </div>
      )}

      <div
        className={`border px-3 py-2 min-w-0 ${failed ? 'border-destructive' : 'border-foreground'} ${needsSetup && setupHelpText ? 'border-t-0' : ''}`}
      >
        {!error && (
          <div className="flex items-center gap-1.5 text-sm shrink-0">
            <span>{t('diff.filesChanged', { count: fileCount })}</span>
            <span className="opacity-50">•</span>
            <span className="text-green-600 dark:text-green-400">
              +{added}
            </span>
            <span className="opacity-50">•</span>
            <span className="text-red-600 dark:text-red-400">-{deleted}</span>
          </div>
        )}
      </div>
    </div>
  );
}
