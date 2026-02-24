import { projectsApi, tagsApi } from '@/lib/api';
import type { SearchResult, Tag } from 'shared/types';

interface FileSearchResult extends SearchResult {
  name: string;
}

export interface SearchResultItem {
  type: 'tag' | 'file';
  tag?: Tag;
  file?: FileSearchResult;
}

export async function searchTagsAndFiles(
  query: string,
  projectId?: string
): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];

  const tags = await tagsApi.list({
    search: query || null,
    project_id: projectId ?? null,
    include_global: projectId ? true : null,
  });
  results.push(...tags.map((tag) => ({ type: 'tag' as const, tag })));

  // Fetch files (if projectId is available and query has content)
  if (projectId && query.length > 0) {
    const fileResults = await projectsApi.searchFiles(projectId, query);
    const fileSearchResults: FileSearchResult[] = fileResults.map((item) => ({
      ...item,
      name: item.path.split('/').pop() || item.path,
    }));
    results.push(
      ...fileSearchResults.map((file) => ({ type: 'file' as const, file }))
    );
  }

  return results;
}
