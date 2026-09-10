import { typeDefs, resolvers } from '../graphql/schema';

describe('schema/index', () => {
  it('aggregates all typeDefs from every module', () => {
    expect(Array.isArray(typeDefs)).toBe(true);
    expect(typeDefs.length).toBe(6);
    typeDefs.forEach((doc) => {
      expect(doc).toHaveProperty('kind', 'Document');
    });
  });

  it('aggregates all resolvers from every module', () => {
    expect(Array.isArray(resolvers)).toBe(true);
    expect(resolvers.length).toBe(6);
  });

  it('rootResolvers._empty returns true for Query and Mutation', () => {
    const [root] = resolvers as Array<{
      Query: { _empty: () => boolean };
      Mutation: { _empty: () => boolean };
    }>;
    expect(root.Query._empty()).toBe(true);
    expect(root.Mutation._empty()).toBe(true);
  });
});
