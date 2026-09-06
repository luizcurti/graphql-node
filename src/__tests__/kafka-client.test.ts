describe('kafka client', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_CLIENT_ID;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns null when KAFKA_BROKERS is not set', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getKafka } = require('../kafka/client');
    expect(getKafka()).toBeNull();
  });

  it('returns a Kafka instance when KAFKA_BROKERS is set', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092, localhost:9093';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getKafka } = require('../kafka/client');
    expect(getKafka()).not.toBeNull();
  });

  it('memoizes the Kafka instance across calls, including a first null result', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getKafka } = require('../kafka/client');
    expect(getKafka()).toBeNull();

    process.env.KAFKA_BROKERS = 'localhost:9092';
    expect(getKafka()).toBeNull();
  });
});
