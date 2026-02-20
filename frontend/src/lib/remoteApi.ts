import { ApiError } from './api';
import { UserData, AssigneesQuery } from 'shared/types';

export const REMOTE_API_URL = import.meta.env.VITE_VK_SHARED_API_BASE || '';

const makeRequest = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  void path;
  void options;
  throw new Error('Remote API authentication not available (OAuth removed)');
};

export const getSharedTaskAssignees = async (
  projectId: string
): Promise<UserData[]> => {
  const response = await makeRequest(
    `/v1/tasks/assignees?${new URLSearchParams({
      project_id: projectId,
    } as AssigneesQuery)}`
  );

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const err = await response.json();
      if (err?.message) message = err.message;
    } catch {
      // empty
    }
    throw new ApiError(message, response.status, response);
  }
  return response.json();
};
