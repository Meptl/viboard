import { REMOTE_API_URL } from '@/lib/remoteApi';

export const createAuthenticatedShapeOptions = (table: string) => ({
  url: `${REMOTE_API_URL}/v1/shape/${table}`,
  headers: {
    Authorization: async () => {
      return '';
    },
  },
  parser: {
    timestamptz: (value: string) => value,
  },
});
