import { projectsApi, tagsApi, tasksApi } from '@/lib/api';
import { Fzf } from 'fzf';
import type { SearchResult, Tag, TaskWithAttemptStatus } from 'shared/types';

const MAX_FILE_RESULTS = 4;
const MAX_TASK_RESULTS = 4;

interface FileSearchResult extends SearchResult {
  name: string;
}

function normalizeTaskSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function isSubsequenceMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  let queryIndex = 0;
  const haystackLower = haystack.toLowerCase();
  const needleLower = needle.toLowerCase();

  for (let i = 0; i < haystackLower.length; i += 1) {
    if (haystackLower[i] === needleLower[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === needleLower.length) return true;
    }
  }

  return false;
}

function rankTagsWithFzf(tags: Tag[], query: string): Tag[] {
  if (tags.length === 0) return tags;
  if (query.length === 0) return tags;
  const filteredTags = tags.filter((tag) =>
    isSubsequenceMatch(tag.tag_name, query)
  );
  if (filteredTags.length === 0) return [];

  const fzf = new Fzf(filteredTags, {
    selector: (tag) => tag.tag_name,
    forward: false,
  });

  return fzf.find(query).map((result) => result.item);
}

function rankTasksWithFzf(tasks: TaskWithAttemptStatus[], query: string) {
  if (tasks.length === 0) return tasks;
  if (query.length === 0) return tasks;
  const filteredTasks = tasks.filter((task) => {
    const taskAlias = normalizeTaskSearchText(task.title);
    return (
      isSubsequenceMatch(task.title, query) ||
      isSubsequenceMatch(taskAlias, query) ||
      isSubsequenceMatch(task.id, query)
    );
  });
  if (filteredTasks.length === 0) return [];

  const fzf = new Fzf(filteredTasks, {
    selector: (task) => {
      const taskAlias = normalizeTaskSearchText(task.title);
      return `${task.title}\n${taskAlias}\n${task.id}`;
    },
    forward: false,
  });

  return fzf.find(query).map((result) => result.item);
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
  options?: { includeTasks?: boolean; taskSnapshot?: TaskWithAttemptStatus[] }
): Promise<SearchResultItem[]> {
  const trimmedQuery = query.trim();

  const tags = await tagsApi.list({
    search: null,
    project_id: projectId ?? null,
    include_global: projectId ? true : null,
  });
  const matchedTags = rankTagsWithFzf(tags, trimmedQuery);
  const tagResults = matchedTags.map((tag) => ({ type: 'tag' as const, tag }));

  // Fetch files (if projectId is available and query has content)
  if (projectId && trimmedQuery.length > 0) {
    const searchedFiles = await projectsApi.searchFiles(projectId, trimmedQuery);
    const fileSearchResults: FileSearchResult[] = searchedFiles
      .map((item) => ({
        ...item,
        name: item.path.split('/').pop() || item.path,
      }))
      .slice(0, MAX_FILE_RESULTS);
    const fileMentionResults = fileSearchResults.map((file) => ({
      type: 'file' as const,
      file,
    }));

    if (options?.includeTasks) {
      const tasks = options.taskSnapshot ?? (await tasksApi.list(projectId));
      const matchedTasks = rankTasksWithFzf(tasks, trimmedQuery).slice(
        0,
        MAX_TASK_RESULTS
      );
      const taskResults = matchedTasks.map((task) => ({
        type: 'task' as const,
        task,
      }));

      return [...tagResults, ...taskResults, ...fileMentionResults];
    }

    return [...tagResults, ...fileMentionResults];
  }

  if (projectId && options?.includeTasks) {
    const tasks = options.taskSnapshot ?? (await tasksApi.list(projectId));
    const matchedTasks = rankTasksWithFzf(tasks, trimmedQuery).slice(
      0,
      MAX_TASK_RESULTS
    );
    const taskResults = matchedTasks.map((task) => ({
      type: 'task' as const,
      task,
    }));
    return [...tagResults, ...taskResults];
  }

  return tagResults;
}
