// mysql2 surfaces a unique-constraint violation with this driver error code.
export const isDuplicateEntryError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === 'ER_DUP_ENTRY';
