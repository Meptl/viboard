import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';

type ScheduleKind = 'every' | 'cron' | 'at';

interface CronsTabProps {
  projectId?: string;
  isActive: boolean;
}

export function CronsTab({ projectId, isActive }: CronsTabProps) {
  const [cronForm, setCronForm] = useState({
    id: '',
    name: '',
    scheduleKind: 'every' as ScheduleKind,
    everyMs: '3600000',
    cronExpr: '0 9 * * *',
    cronTz: '',
    at: '',
    prompt: '',
  });

  const cronsQuery = useQuery({
    queryKey: ['openclaw-crons', projectId],
    queryFn: () => projectsApi.getOpenclawCrons(projectId!),
    enabled: !!projectId && isActive,
    staleTime: 5_000,
    refetchInterval: isActive ? 10_000 : false,
  });

  const createCronMutation = useMutation({
    mutationFn: () => {
      const schedule =
        cronForm.scheduleKind === 'cron'
          ? {
              kind: 'cron',
              expr: cronForm.cronExpr.trim(),
              ...(cronForm.cronTz.trim() ? { tz: cronForm.cronTz.trim() } : {}),
            }
          : cronForm.scheduleKind === 'at'
            ? { kind: 'at', at: new Date(cronForm.at).toISOString() }
            : { kind: 'every', everyMs: Number(cronForm.everyMs || '3600000') };

      return projectsApi.createOpenclawCron(projectId!, {
        name: cronForm.name.trim() || undefined,
        enabled: true,
        schedule,
        payload: { kind: 'agentTurn', message: cronForm.prompt.trim() },
      });
    },
    onSuccess: async () => {
      setCronForm({
        id: '',
        name: '',
        scheduleKind: 'every',
        everyMs: '3600000',
        cronExpr: '0 9 * * *',
        cronTz: '',
        at: '',
        prompt: '',
      });
      await cronsQuery.refetch();
    },
  });

  const updateCronMutation = useMutation({
    mutationFn: () => {
      const schedule =
        cronForm.scheduleKind === 'cron'
          ? {
              kind: 'cron',
              expr: cronForm.cronExpr.trim(),
              ...(cronForm.cronTz.trim() ? { tz: cronForm.cronTz.trim() } : {}),
            }
          : cronForm.scheduleKind === 'at'
            ? { kind: 'at', at: new Date(cronForm.at).toISOString() }
            : { kind: 'every', everyMs: Number(cronForm.everyMs || '3600000') };

      return projectsApi.updateOpenclawCron(projectId!, cronForm.id, {
        name: cronForm.name.trim() || undefined,
        enabled: true,
        schedule,
        payload: { kind: 'agentTurn', message: cronForm.prompt.trim() },
      });
    },
    onSuccess: async () => {
      setCronForm((prev) => ({ ...prev, id: '' }));
      await cronsQuery.refetch();
    },
  });

  const deleteCronMutation = useMutation({
    mutationFn: (cronId: string) => projectsApi.deleteOpenclawCron(projectId!, cronId),
    onSuccess: async () => {
      await cronsQuery.refetch();
    },
  });

  const toggleCronMutation = useMutation({
    mutationFn: ({ cronId, enabled }: { cronId: string; enabled: boolean }) =>
      projectsApi.toggleOpenclawCron(projectId!, cronId, enabled),
    onSuccess: async () => {
      await cronsQuery.refetch();
    },
  });

  return (
    <section className="p-3 space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Crons
      </h3>
      <form
        className="space-y-2 rounded-md border bg-background p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!cronForm.prompt.trim()) return;
          if (cronForm.id) await updateCronMutation.mutateAsync();
          else await createCronMutation.mutateAsync();
        }}
      >
        <input
          value={cronForm.name}
          onChange={(e) => setCronForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="Name (optional)"
          className="w-full border bg-background px-2 py-1.5 text-xs"
        />
        <select
          value={cronForm.scheduleKind}
          onChange={(e) =>
            setCronForm((p) => ({
              ...p,
              scheduleKind: e.target.value as ScheduleKind,
            }))
          }
          className="w-full border bg-background px-2 py-1.5 text-xs"
        >
          <option value="every">Recurring interval</option>
          <option value="cron">Cron expression</option>
          <option value="at">One-shot at time</option>
        </select>
        {cronForm.scheduleKind === 'every' ? (
          <select
            value={cronForm.everyMs}
            onChange={(e) => setCronForm((p) => ({ ...p, everyMs: e.target.value }))}
            className="w-full border bg-background px-2 py-1.5 text-xs"
          >
            <option value="300000">5 minutes</option>
            <option value="900000">15 minutes</option>
            <option value="1800000">30 minutes</option>
            <option value="3600000">1 hour</option>
            <option value="7200000">2 hours</option>
            <option value="21600000">6 hours</option>
            <option value="43200000">12 hours</option>
            <option value="86400000">24 hours</option>
          </select>
        ) : cronForm.scheduleKind === 'cron' ? (
          <>
            <input
              value={cronForm.cronExpr}
              onChange={(e) => setCronForm((p) => ({ ...p, cronExpr: e.target.value }))}
              placeholder="0 9 * * *"
              className="w-full border bg-background px-2 py-1.5 text-xs"
            />
            <input
              value={cronForm.cronTz}
              onChange={(e) => setCronForm((p) => ({ ...p, cronTz: e.target.value }))}
              placeholder="Timezone (optional)"
              className="w-full border bg-background px-2 py-1.5 text-xs"
            />
          </>
        ) : (
          <input
            type="datetime-local"
            value={cronForm.at}
            onChange={(e) => setCronForm((p) => ({ ...p, at: e.target.value }))}
            className="w-full border bg-background px-2 py-1.5 text-xs"
          />
        )}
        <textarea
          value={cronForm.prompt}
          onChange={(e) => setCronForm((p) => ({ ...p, prompt: e.target.value }))}
          placeholder="Prompt"
          className="w-full min-h-20 border bg-background px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={createCronMutation.isPending || updateCronMutation.isPending}
          className="w-full border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {cronForm.id ? 'Update cron' : 'Create cron'}
        </button>
      </form>
      {cronsQuery.isLoading ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          Loading crons...
        </div>
      ) : cronsQuery.isError ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          Failed to load crons.
        </div>
      ) : (cronsQuery.data?.jobs.length ?? 0) === 0 ? (
        <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
          No crons configured for this project workspace.
        </div>
      ) : (
        cronsQuery.data?.jobs.map((job) => (
          <div key={job.id} className="rounded-md border bg-background p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium">{job.name || job.id}</p>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={job.enabled}
                  onChange={(e) =>
                    toggleCronMutation.mutate({
                      cronId: job.id,
                      enabled: e.target.checked,
                    })
                  }
                />
                enabled
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {job.schedule.kind === 'every'
                ? `Every ${Math.round((job.schedule.every_ms ?? 0) / 60000)} minutes`
                : job.schedule.kind === 'cron'
                  ? `Cron: ${job.schedule.expr ?? ''}${job.schedule.tz ? ` (${job.schedule.tz})` : ''}`
                  : `At ${job.schedule.at ?? ''}`}
            </p>
            <p className="whitespace-pre-wrap text-xs">{job.payload.prompt}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="border px-2 py-1 text-xs"
                onClick={() =>
                  setCronForm({
                    id: job.id,
                    name: job.name || '',
                    scheduleKind: (job.schedule.kind as ScheduleKind) || 'every',
                    everyMs: String(job.schedule.every_ms ?? 3600000),
                    cronExpr: job.schedule.expr ?? '0 9 * * *',
                    cronTz: job.schedule.tz ?? '',
                    at: job.schedule.at
                      ? new Date(job.schedule.at).toISOString().slice(0, 16)
                      : '',
                    prompt: job.payload.prompt ?? '',
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                className="border px-2 py-1 text-xs text-destructive"
                onClick={() => deleteCronMutation.mutate(job.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
