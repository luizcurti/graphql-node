type EachMessage = (payload: {
  message: { value: Buffer | null };
}) => Promise<void>;

describe('kafka consumer', () => {
  const publishMock = jest.fn();

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
    jest.doMock('../graphql/pubsub', () => ({
      pubSub: { publish: publishMock },
      CREATED_COMMENT_TRIGGER: 'CREATED_COMMENT',
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
  });
});
