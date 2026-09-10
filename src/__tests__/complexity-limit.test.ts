import { buildSchema, parse } from 'graphql';
import {
  complexityLimitPlugin,
  MAX_QUERY_COMPLEXITY,
} from '../graphql/complexity-limit';

const schema = buildSchema(`
  type Query {
    a: String
    b: String
    c: String
  }
`);

const runCheck = async (
  document: ReturnType<typeof parse>,
  variables: Record<string, unknown> = {},
) => {
  const listener = await complexityLimitPlugin.requestDidStart!({} as never);
  return listener!.didResolveOperation!({
    document,
    request: { variables },
    operationName: null,
    schema,
  } as never);
};

describe('complexityLimitPlugin', () => {
  it('allows a query well under the complexity budget', async () => {
    await expect(runCheck(parse('{ a b c }'))).resolves.toBeUndefined();
  });

  it('rejects a query over the complexity budget (many aliases, low depth)', async () => {
    // Low depth (1), but each alias adds its own selection — exactly the
    // wide-but-shallow shape depthLimit(7) alone wouldn't catch.
    const aliasedFields = Array.from(
      { length: MAX_QUERY_COMPLEXITY + 1 },
      (_, i) => `f${i}: a`,
    ).join(' ');

    await expect(runCheck(parse(`{ ${aliasedFields} }`))).rejects.toThrow(
      /exceeds the maximum complexity of 1000/,
    );
  });

  it("coerces the request's real variable values for queries with required variables", async () => {
    // Regression check: this plugin exists (instead of a validationRules
    // entry) specifically because graphql-query-complexity needs real
    // variable values to coerce required variables — without them, a query
    // like this one fails with "Variable \"$id\" ... was not provided"
    // before it ever computes a complexity score. See ../graphql/complexity-limit.ts.
    const schemaWithArgs = buildSchema(`
      type Query {
        byId(id: ID!): String
      }
    `);
    const listener = await complexityLimitPlugin.requestDidStart!({} as never);

    await expect(
      listener!.didResolveOperation!({
        document: parse('query($id: ID!) { byId(id: $id) }'),
        request: { variables: { id: '1' } },
        operationName: null,
        schema: schemaWithArgs,
      } as never),
    ).resolves.toBeUndefined();
  });
});

describe('MAX_QUERY_COMPLEXITY — env override', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('happy path: uses MAX_QUERY_COMPLEXITY from the environment when set', () => {
    process.env.MAX_QUERY_COMPLEXITY = '5';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../graphql/complexity-limit');
    expect(mod.MAX_QUERY_COMPLEXITY).toBe(5);
  });

  it('sad path: falls back to 1000 when MAX_QUERY_COMPLEXITY is unset', () => {
    delete process.env.MAX_QUERY_COMPLEXITY;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../graphql/complexity-limit');
    expect(mod.MAX_QUERY_COMPLEXITY).toBe(1000);
  });

  it('sad path: falls back to 1000 when MAX_QUERY_COMPLEXITY is not a valid number', () => {
    process.env.MAX_QUERY_COMPLEXITY = 'not-a-number';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../graphql/complexity-limit');
    expect(mod.MAX_QUERY_COMPLEXITY).toBe(1000);
  });
});
