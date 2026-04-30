import { useEffect, useMemo, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
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
import { Checkbox } from '@/components/ui/checkbox';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export interface DoneTaskCandidate {
  id: string;
  updated_at: string;
}

export interface DoneCleanupDialogProps {
  defaultDays: number;
  doneTasks: DoneTaskCandidate[];
  automaticCleanupEnabled: boolean;
  automaticCleanupDays: number;
  onSaveAutomaticCleanup?: (params: {
    enabled: boolean;
    olderThanDays: number;
  }) => Promise<void> | void;
}

export type DoneCleanupDialogResult =
  | { status: 'confirmed'; olderThanDays: number }
  | { status: 'canceled' };

const normalizeDays = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const DoneCleanupDialogImpl = NiceModal.create<DoneCleanupDialogProps>(
  ({
    defaultDays,
    doneTasks,
    automaticCleanupEnabled,
    automaticCleanupDays,
    onSaveAutomaticCleanup,
  }) => {
    const modal = useModal();
    const [daysInput, setDaysInput] = useState(
      String(normalizeDays(defaultDays))
    );
    const [autoEnabled, setAutoEnabled] = useState(automaticCleanupEnabled);
    const [autoDaysInput, setAutoDaysInput] = useState(
      String(normalizeDays(automaticCleanupDays))
    );
    const [initialAutoEnabled, setInitialAutoEnabled] = useState(
      automaticCleanupEnabled
    );
    const [initialAutoDays, setInitialAutoDays] = useState(
      normalizeDays(automaticCleanupDays)
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [autoSaved, setAutoSaved] = useState(false);

    useEffect(() => {
      if (!modal.visible) {
        return;
      }
      const normalizedAutomaticDays = normalizeDays(automaticCleanupDays);
      setAutoEnabled(automaticCleanupEnabled);
      setAutoDaysInput(String(normalizedAutomaticDays));
      setInitialAutoEnabled(automaticCleanupEnabled);
      setInitialAutoDays(normalizedAutomaticDays);
      setAutoSaved(false);
    }, [automaticCleanupDays, automaticCleanupEnabled, modal.visible]);

    const daysValue = useMemo(() => {
      const parsed = Number(daysInput);
      if (!Number.isFinite(parsed)) return null;
      return normalizeDays(parsed);
    }, [daysInput]);

    const cutoffDate = useMemo(() => {
      if (daysValue === null) return null;
      return new Date(Date.now() - daysValue * DAY_IN_MS);
    }, [daysValue]);
    const autoDaysValue = useMemo(() => {
      const parsed = Number(autoDaysInput);
      if (!Number.isFinite(parsed)) return null;
      return normalizeDays(parsed);
    }, [autoDaysInput]);
    const hasAutomaticChanges = useMemo(() => {
      if (autoEnabled !== initialAutoEnabled) {
        return true;
      }
      if (autoDaysValue === null) {
        return false;
      }
      return autoDaysValue !== initialAutoDays;
    }, [autoDaysValue, autoEnabled, initialAutoDays, initialAutoEnabled]);
    const canSaveAutomatic = useMemo(
      () =>
        !isSubmitting &&
        hasAutomaticChanges &&
        (!autoEnabled || autoDaysValue !== null),
      [hasAutomaticChanges, isSubmitting, autoDaysValue, autoEnabled]
    );

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

    const handleSaveAutomatic = async () => {
      if (autoEnabled && autoDaysValue === null) return;
      try {
        setIsSubmitting(true);
        const nextOlderThanDays =
          autoDaysValue === null ? initialAutoDays : autoDaysValue;
        await onSaveAutomaticCleanup?.({
          enabled: autoEnabled,
          olderThanDays: nextOlderThanDays,
        });
        setInitialAutoEnabled(autoEnabled);
        setInitialAutoDays(nextOlderThanDays);
        setAutoSaved(true);
      } catch (error) {
        console.error('Failed to save automatic cleanup:', error);
      } finally {
        setIsSubmitting(false);
      }
    };

    useEffect(() => {
      if (!autoSaved) return;
      const timerId = window.setTimeout(() => {
        setAutoSaved(false);
      }, 3000);
      return () => {
        window.clearTimeout(timerId);
      };
    }, [autoSaved]);

    const handleAutomaticCheckboxChange = (checked: boolean) => {
      const nextChecked = checked === true;
      setAutoSaved(false);
      setAutoEnabled(nextChecked);
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clean up done tasks</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="done-cleanup-days">Older than (days)</Label>
              <Input
                id="done-cleanup-days"
                type="number"
                min={0}
                step={1}
                value={daysInput}
                onChange={(event) => setDaysInput(event.target.value)}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {`${eligibleCount} of ${doneTasks.length} done tasks will be deleted.`}
            </p>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="automatic-done-cleanup"
                  checked={autoEnabled}
                  onCheckedChange={handleAutomaticCheckboxChange}
                  disabled={isSubmitting}
                />
                <Label
                  htmlFor="automatic-done-cleanup"
                  className="cursor-pointer font-medium"
                >
                  {autoEnabled
                    ? 'Automatic cleanup older than (days)'
                    : 'Automatic cleanup'}
                </Label>
                {autoEnabled ? (
                  <Input
                    id="automatic-done-cleanup-days"
                    type="number"
                    min={0}
                    step={1}
                    value={autoDaysInput}
                    onChange={(event) => {
                      setAutoDaysInput(event.target.value);
                      setAutoSaved(false);
                    }}
                    disabled={isSubmitting}
                    className="w-24"
                  />
                ) : null}
                <Button
                  variant="outline"
                  onClick={handleSaveAutomatic}
                  disabled={!canSaveAutomatic}
                  className={
                    canSaveAutomatic
                      ? 'ml-auto bg-emerald-200 border-emerald-300 text-emerald-900 hover:bg-emerald-300 font-semibold'
                      : 'ml-auto bg-transparent text-muted-foreground'
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            {autoSaved ? (
              <span className="mr-auto self-center text-sm text-muted-foreground">
                Saved.
              </span>
            ) : null}
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={
                isSubmitting || daysValue === null || eligibleCount === 0
              }
            >
              Delete tasks
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
