import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import type { Project } from 'shared/types';

interface UseProjectsOptions {
  enabled?: boolean;
}

export function useProjects(options?: UseProjectsOptions) {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll(),
    enabled: options?.enabled ?? true,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}
