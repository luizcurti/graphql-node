// Integration test config — exercises the real datasources against a live
// MySQL database (see .env / docker-compose.yml). Requires migrate + seed to
// have been run against that database first (`npm run db:setup`).
module.exports = {
  transform: {
    '^.+\\.[jt]sx?$': '@sucrase/jest-plugin',
  },
  testMatch: ['**/__tests__/integration/**/*.integration.test.ts'],
};
