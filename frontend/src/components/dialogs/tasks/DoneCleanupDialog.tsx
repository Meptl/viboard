import { useMemo, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { defineModal } from '@/lib/modals';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface DoneTaskCandidate {
  id: string;
  updated_at: string;
}

export interface DoneCleanupDialogProps {
  defaultDays: number;
  doneTasks: DoneTaskCandidate[];
}

export type DoneCleanupDialogResult =
  | { status: 'confirmed'; olderThanDays: number }
  | { status: 'canceled' };

const normalizeDays = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
};

const DoneCleanupDialogImpl = NiceModal.create<DoneCleanupDialogProps>(
  ({ defaultDays, doneTasks }) => {
    const modal = useModal();
    const { t } = useTranslation('tasks');
    const [daysInput, setDaysInput] = useState(String(normalizeDays(defaultDays)));
    const [isSubmitting, setIsSubmitting] = useState(false);

    const daysValue = useMemo(() => {
      const parsed = Number(daysInput);
      if (!Number.isFinite(parsed)) return null;
      return normalizeDays(parsed);
    }, [daysInput]);

    const cutoffDate = useMemo(() => {
      if (daysValue === null) return null;
      return new Date(Date.now() - daysValue * DAY_IN_MS);
    }, [daysValue]);

    const eligibleCount = useMemo(() => {
      if (!cutoffDate) return 0;
      const cutoffTime = cutoffDate.getTime();
      return doneTasks.filter(
        (task) => new Date(task.updated_at).getTime() <= cutoffTime
      ).length;
    }, [cutoffDate, doneTasks]);

    const handleCancel = () => {
      modal.resolve({ status: 'canceled' } as DoneCleanupDialogResult);
      modal.hide();
    };

    const handleConfirm = async () => {
      if (daysValue === null) return;
      setIsSubmitting(true);
      modal.resolve({
        status: 'confirmed',
        olderThanDays: daysValue,
      } as DoneCleanupDialogResult);
      modal.hide();
      setIsSubmitting(false);
    };

    return (
      <Dialog open={modal.visible} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('doneCleanup.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="done-cleanup-days">{t('doneCleanup.daysLabel')}</Label>
              <Input
                id="done-cleanup-days"
                type="number"
                min={1}
                step={1}
                value={daysInput}
                onChange={(event) => setDaysInput(event.target.value)}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {t('doneCleanup.eligibleCount', {
                count: eligibleCount,
                total: doneTasks.length,
              })}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              {t('doneCleanup.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isSubmitting || daysValue === null || eligibleCount === 0}
            >
              {t('doneCleanup.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const DoneCleanupDialog = defineModal<
  DoneCleanupDialogProps,
  DoneCleanupDialogResult
>(DoneCleanupDialogImpl);
