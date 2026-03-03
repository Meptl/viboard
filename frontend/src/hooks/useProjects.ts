import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import type { Project } from 'shared/types';

interface UseProjectsOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
}

const DEFAULT_RETRY_LIMIT = 5;
const DEFAULT_STALE_TIME_MS = 30000;
const DEFAULT_ERROR_REFETCH_INTERVAL_MS = 10000;

export function useProjects(options?: UseProjectsOptions) {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    enabled: options?.enabled ?? true,
    staleTime: DEFAULT_STALE_TIME_MS,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    retry: (failureCount) => failureCount < DEFAULT_RETRY_LIMIT,
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    retryDelay: (attemptIndex) => Math.min(16000, 1000 * 2 ** attemptIndex),
    refetchInterval: (query) => {
      if (typeof options?.refetchInterval === 'number') {
        return options.refetchInterval;
      }
      if (options?.refetchInterval === false) {
        return false;
      }

      return query.state.error ? DEFAULT_ERROR_REFETCH_INTERVAL_MS : false;
    },
  });
}
