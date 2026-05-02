import { ApiError } from '@/lib/api';

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}
