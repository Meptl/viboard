import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ProcessesTab from '@/components/tasks/TaskDetails/ProcessesTab';
import { ProcessSelectionProvider } from '@/contexts/ProcessSelectionContext';
import { useAttempt } from '@/hooks/useAttempt';
import { cn } from '@/lib/utils';

export interface ViewProcessesDialogProps {
  attemptId: string;
  initialProcessId?: string | null;
}

const ViewProcessesDialogImpl = NiceModal.create<ViewProcessesDialogProps>(
  ({ attemptId, initialProcessId }) => {
    const { t } = useTranslation('tasks');
    const modal = useModal();
    const [activeTab, setActiveTab] = useState<'general' | 'processes'>(
      'general'
    );
    const { data: attempt } = useAttempt(attemptId, { enabled: !!attemptId });

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        modal.hide();
      }
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={handleOpenChange}
        className="max-w-5xl w-[92vw] p-0 overflow-x-hidden"
      >
        <DialogContent
          className="p-0 min-w-0"
          onKeyDownCapture={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              modal.hide();
            }
          }}
        >
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle>{t('viewProcessesDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="h-[75vh] flex flex-col min-h-0 min-w-0">
            <div className="px-4 py-3 border-b">
              <div className="inline-flex items-center gap-6">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-auto p-0 hover:bg-transparent border-0',
                    activeTab === 'general'
                      ? 'font-semibold text-foreground hover:text-foreground cursor-default'
                      : 'font-medium text-muted-foreground/60'
                  )}
                  onClick={() => setActiveTab('general')}
                >
                  {t('viewProcessesDialog.tabs.general')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    'h-auto p-0 hover:bg-transparent border-0',
                    activeTab === 'processes'
                      ? 'font-semibold text-foreground hover:text-foreground cursor-default'
                      : 'font-medium text-muted-foreground/60'
                  )}
                  onClick={() => setActiveTab('processes')}
                >
                  {t('viewProcessesDialog.tabs.processes')}
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 min-w-0">
              <div
                className={cn(
                  'h-full p-4 overflow-auto',
                  activeTab === 'general' ? 'block' : 'hidden'
                )}
              >
                <div className="space-y-4 max-w-2xl">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('viewProcessesDialog.general.taskId')}
                    </p>
                    <p className="font-mono text-sm break-all">
                      {attempt?.task_id ?? '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('viewProcessesDialog.general.attemptId')}
                    </p>
                    <p className="font-mono text-sm break-all">{attemptId}</p>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  'h-full min-h-0 min-w-0',
                  activeTab === 'processes' ? 'block' : 'hidden'
                )}
              >
                <ProcessSelectionProvider initialProcessId={initialProcessId}>
                  <ProcessesTab attemptId={attemptId} />
                </ProcessSelectionProvider>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ViewProcessesDialog = defineModal<ViewProcessesDialogProps, void>(
  ViewProcessesDialogImpl
);
