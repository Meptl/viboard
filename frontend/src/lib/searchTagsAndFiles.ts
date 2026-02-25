import { projectsApi, tagsApi, tasksApi } from '@/lib/api';
import type { SearchResult, Tag, TaskWithAttemptStatus } from 'shared/types';

interface FileSearchResult extends SearchResult {
  name: string;
}

function normalizeTaskSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export interface SearchResultItem {
  type: 'tag' | 'file' | 'task';
  tag?: Tag;
  file?: FileSearchResult;
  task?: TaskWithAttemptStatus;
}

export async function searchTagsAndFiles(
  query: string,
  projectId?: string,
  options?: { includeTasks?: boolean }
): Promise<SearchResultItem[]> {
  const tagResults: SearchResultItem[] = [];
  const taskResults: SearchResultItem[] = [];
  const fileMentionResults: SearchResultItem[] = [];
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const normalizedTaskQuery = normalizeTaskSearchText(trimmedQuery);

  const tags = await tagsApi.list({
    search: trimmedQuery || null,
    project_id: projectId ?? null,
    include_global: projectId ? true : null,
  });
  tagResults.push(...tags.map((tag) => ({ type: 'tag' as const, tag })));

  // Fetch files (if projectId is available and query has content)
  if (projectId && trimmedQuery.length > 0) {
    const searchedFiles = await projectsApi.searchFiles(projectId, trimmedQuery);
    const fileSearchResults: FileSearchResult[] = searchedFiles.map((item) => ({
      ...item,
      name: item.path.split('/').pop() || item.path,
    }));
    fileMentionResults.push(
      ...fileSearchResults.map((file) => ({ type: 'file' as const, file }))
    );
  }

  if (projectId && options?.includeTasks) {
    const tasks = await tasksApi.list(projectId);
    const matchingTasks =
      normalizedQuery.length === 0
        ? tasks
        : tasks.filter((task) => {
            const lowerTitle = task.title.toLowerCase();
            const normalizedTitle = normalizeTaskSearchText(task.title);
            return (
              lowerTitle.includes(normalizedQuery) ||
              normalizedTitle.includes(normalizedTaskQuery)
            );
          });
    taskResults.push(
      ...matchingTasks.map((task) => ({ type: 'task' as const, task }))
    );
  }

  return [...tagResults, ...taskResults, ...fileMentionResults];
}
