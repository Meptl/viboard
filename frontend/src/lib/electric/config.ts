const SHAPE_API_BASE = '';

export const createAuthenticatedShapeOptions = (table: string) => ({
  url: `${SHAPE_API_BASE}/v1/shape/${table}`,
  headers: {
    Authorization: async () => {
      return '';
    },
  },
  parser: {
    timestamptz: (value: string) => value,
  },
});
