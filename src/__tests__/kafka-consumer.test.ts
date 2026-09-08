type EachMessage = (payload: {
  message: { value: Buffer | null };
}) => Promise<void>;

describe('kafka consumer', () => {
  const publishMock = jest.fn();
  const kafkaMessagesConsumedTotal = { inc: jest.fn() };

  const makeConsumer = () => {
    let eachMessage: EachMessage;
    const consumer = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockImplementation(async ({ eachMessage: fn }) => {
        eachMessage = fn;
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    return {
      consumer,
      getEachMessage: (): EachMessage => eachMessage,
    };
  };

  beforeEach(() => {
    jest.resetModules();
    publishMock.mockClear();
    kafkaMessagesConsumedTotal.inc.mockClear();
    jest.doMock('../graphql/pubsub', () => ({
      pubSub: { publish: publishMock },
      CREATED_COMMENT_TRIGGER: 'CREATED_COMMENT',
    }));
    jest.doMock('../observability/metrics', () => ({
      kafkaMessagesConsumedTotal,
    }));
  });

  it('does nothing when Kafka is not configured', async () => {
    jest.doMock('../kafka/client', () => ({ getKafka: () => null }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consumerModule = require('../kafka/consumer');
    const { startCommentConsumer, stopCommentConsumer } = consumerModule;

    await expect(startCommentConsumer()).resolves.toBeUndefined();
    await expect(stopCommentConsumer()).resolves.toBeUndefined();
  });

  it('subscribes to the comment.created topic and republishes messages onto pubSub', async () => {
    const { consumer, getEachMessage } = makeConsumer();
    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ consumer: () => consumer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consumerModule = require('../kafka/consumer');
    const { startCommentConsumer, stopCommentConsumer } = consumerModule;
    await startCommentConsumer();

    expect(consumer.connect).toHaveBeenCalled();
    expect(consumer.subscribe).toHaveBeenCalledWith({
      topic: 'comment.created',
      fromBeginning: false,
    });

    const event = { createdComment: { id: 1 }, postOwner: 'owner1' };
    await getEachMessage()({
      message: { value: Buffer.from(JSON.stringify(event)) },
    });

    expect(publishMock).toHaveBeenCalledWith('CREATED_COMMENT', event);
    expect(kafkaMessagesConsumedTotal.inc).toHaveBeenCalledWith({
      topic: 'comment.created',
      status: 'success',
    });

    await stopCommentConsumer();
    expect(consumer.disconnect).toHaveBeenCalled();
  });

  it('ignores messages with no value', async () => {
    const { consumer, getEachMessage } = makeConsumer();
    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ consumer: () => consumer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startCommentConsumer } = require('../kafka/consumer');
    await startCommentConsumer();

    await getEachMessage()({ message: { value: null } });

    expect(publishMock).not.toHaveBeenCalled();
  });

  it('logs and swallows errors for malformed message payloads', async () => {
    const { consumer, getEachMessage } = makeConsumer();
    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ consumer: () => consumer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startCommentConsumer } = require('../kafka/consumer');
    await startCommentConsumer();

    await expect(
      getEachMessage()({ message: { value: Buffer.from('not-json') } }),
    ).resolves.toBeUndefined();

    expect(publishMock).not.toHaveBeenCalled();
    expect(kafkaMessagesConsumedTotal.inc).toHaveBeenCalledWith({
      topic: 'comment.created',
      status: 'error',
    });
  });

  it('retries subscribe() when the topic is not yet available, then succeeds', async () => {
    jest.useFakeTimers();
    const { consumer, getEachMessage } = makeConsumer();
    consumer.subscribe
      .mockRejectedValueOnce(new Error('UNKNOWN_TOPIC_OR_PARTITION'))
      .mockRejectedValueOnce(new Error('UNKNOWN_TOPIC_OR_PARTITION'))
      .mockResolvedValueOnce(undefined);
    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ consumer: () => consumer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startCommentConsumer } = require('../kafka/consumer');
    const startPromise = startCommentConsumer();

    await jest.runAllTimersAsync();
    await startPromise;

    expect(consumer.subscribe).toHaveBeenCalledTimes(3);
    expect(consumer.run).toHaveBeenCalled();
    expect(typeof getEachMessage()).toBe('function');

    jest.useRealTimers();
  });

  it('logs and does not throw when subscribe() keeps failing — the server must still start', async () => {
    jest.useFakeTimers();
    const { consumer } = makeConsumer();
    consumer.subscribe.mockRejectedValue(new Error('still unavailable'));
    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ consumer: () => consumer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startCommentConsumer } = require('../kafka/consumer');
    const startPromise = startCommentConsumer();

    await jest.runAllTimersAsync();

    await expect(startPromise).resolves.toBeUndefined();
    expect(consumer.run).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
