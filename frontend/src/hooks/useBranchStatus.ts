import { useQuery } from '@tanstack/react-query';
import { attemptsApi } from '@/lib/api';

export function useBranchStatus(attemptId?: string) {
  return useQuery({
    queryKey: ['branchStatus', attemptId],
    queryFn: () => attemptsApi.getBranchStatus(attemptId!),
    enabled: !!attemptId,
    // Branch/conflict state is highly dynamic; avoid inheriting global 5m stale cache.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    // Poll faster to promptly reflect rebase/abort transitions
    refetchInterval: 5000,
  });
}
