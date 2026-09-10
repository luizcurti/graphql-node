export type ApiFilterOrder = 'asc' | 'desc';

// The complexity plugin (../complexity-limit.ts) counts field *selections*,
// not requested page size, so an uncapped `_limit` (e.g. 500000) is cheap by
// that estimator while still forcing a large table/offset scan. Clamped in
// UserSQLDataSource.getUsers / PostSQLDataSource.getPosts.
export const MAX_PAGE_LIMIT = 100;

export interface ApiFiltersInput {
  _sort?: string;
  _order?: ApiFilterOrder;
  _start?: number;
  _limit?: number;
}
