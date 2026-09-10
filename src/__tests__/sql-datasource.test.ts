import { SQLDatasource } from '../graphql/datasources/sql/sql-datasource';

describe('SQLDatasource (base class)', () => {
  it('stores the db connection in the constructor', () => {
    const db = jest.fn();
    const ds = new SQLDatasource(db as never);
    expect(ds.db).toBe(db);
  });

  it('initialize stores context and cache', () => {
    const ds = new SQLDatasource(jest.fn() as never);
    const context = { foo: 'bar' };
    ds.initialize({ context, cache: undefined });
    expect(ds.context).toBe(context);
  });

  it('initialize works with no arguments', () => {
    const ds = new SQLDatasource(jest.fn() as never);
    expect(() => ds.initialize()).not.toThrow();
  });

  it('default batchLoaderCallback returns the ids unchanged (passthrough)', async () => {
    const ds = new SQLDatasource(jest.fn() as never);
    const result = await ds.batchLoaderCallback(['1', '2']);
    expect(result).toEqual(['1', '2']);
  });

  it('batchLoad delegates to the internal DataLoader using the default passthrough', async () => {
    const ds = new SQLDatasource(jest.fn() as never);
    const result = await ds.batchLoad('42');
    expect(result).toBe('42');
  });
});
