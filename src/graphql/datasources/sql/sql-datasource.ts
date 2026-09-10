import DataLoader from 'dataloader';
import type { Knex } from 'knex';

export interface DatasourceInitOptions {
  context?: unknown;
  cache?: unknown;
}

export class SQLDatasource<TKey = string, TValue = TKey> {
  db: Knex;
  readDb: Knex;
  context?: unknown;
  cache?: unknown;
  private _loader: DataLoader<TKey, TValue>;

  // `readConnection` defaults to the write connection, so subclasses behave
  // exactly as before unless a read replica is explicitly wired in (see
  // ../../../knex/index.ts).
  constructor(dbConnection: Knex, readConnection: Knex = dbConnection) {
    this.db = dbConnection;
    this.readDb = readConnection;
    this._loader = new DataLoader<TKey, TValue>(async (ids) =>
      this.batchLoaderCallback(ids),
    );
  }

  initialize({ context, cache }: DatasourceInitOptions = {}): void {
    this.context = context;
    this.cache = cache;
  }

  async batchLoad(id: TKey): Promise<TValue> {
    return this._loader.load(id);
  }

  async batchLoaderCallback(ids: readonly TKey[]): Promise<TValue[]> {
    return ids as unknown as TValue[];
  }
}
