describe('kafka producer', () => {
  const publishMock = jest.fn();
  const kafkaMessagesProducedTotal = { inc: jest.fn() };

  beforeEach(() => {
    jest.resetModules();
    publishMock.mockClear();
    kafkaMessagesProducedTotal.inc.mockClear();
    jest.doMock('../graphql/pubsub', () => ({
      pubSub: { publish: publishMock },
      CREATED_COMMENT_TRIGGER: 'CREATED_COMMENT',
    }));
    jest.doMock('../observability/metrics', () => ({
      kafkaMessagesProducedTotal,
    }));
  });

  it('publishes directly to pubSub when Kafka is not configured', async () => {
    jest.doMock('../kafka/client', () => ({ getKafka: () => null }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishCommentCreated } = require('../kafka/producer');
    const event = { createdComment: { id: 1 }, postOwner: 'owner1' };

    await publishCommentCreated(event);

    expect(publishMock).toHaveBeenCalledWith('CREATED_COMMENT', event);
  });

  it('disconnectProducer is a no-op when Kafka is not configured', async () => {
    jest.doMock('../kafka/client', () => ({ getKafka: () => null }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { disconnectProducer } = require('../kafka/producer');

    await expect(disconnectProducer()).resolves.toBeUndefined();
  });

  it('sends events to the Kafka topic, connecting only once', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const producer = { connect, send, disconnect };

    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ producer: () => producer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const producerModule = require('../kafka/producer');
    const { publishCommentCreated, disconnectProducer } = producerModule;
    const event = { createdComment: { id: 1 }, postOwner: null };

    await publishCommentCreated(event);
    await publishCommentCreated(event);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({
      topic: 'comment.created',
      messages: [{ value: JSON.stringify(event) }],
    });
    expect(publishMock).not.toHaveBeenCalled();
    expect(kafkaMessagesProducedTotal.inc).toHaveBeenCalledWith({
      topic: 'comment.created',
    });
    expect(kafkaMessagesProducedTotal.inc).toHaveBeenCalledTimes(2);

    await disconnectProducer();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('retries connect() on the next publish after a failed connection attempt', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('broker unreachable'))
      .mockResolvedValueOnce(undefined);
    const producer = { connect, send, disconnect: jest.fn() };

    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ producer: () => producer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishCommentCreated } = require('../kafka/producer');
    const event = { createdComment: { id: 1 }, postOwner: null };

    await expect(publishCommentCreated(event)).rejects.toThrow(
      'broker unreachable',
    );
    await expect(publishCommentCreated(event)).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('publishToDeadLetterQueue is a no-op when Kafka is not configured', async () => {
    jest.doMock('../kafka/client', () => ({ getKafka: () => null }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishToDeadLetterQueue } = require('../kafka/producer');

    await expect(
      publishToDeadLetterQueue('not-json', 'invalid JSON'),
    ).resolves.toBeUndefined();
  });

  it('publishToDeadLetterQueue sends the original payload and reason to the DLQ topic', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(undefined);
    const producer = { connect, send, disconnect: jest.fn() };

    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ producer: () => producer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishToDeadLetterQueue } = require('../kafka/producer');

    await publishToDeadLetterQueue('not-json', 'Unexpected token');

    expect(connect).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      topic: 'comment.created.dlq',
      messages: [
        {
          value: expect.stringContaining('"payload":"not-json"'),
        },
      ],
    });
    const sentValue = JSON.parse(send.mock.calls[0][0].messages[0].value);
    expect(sentValue).toMatchObject({
      originalTopic: 'comment.created',
      reason: 'Unexpected token',
      payload: 'not-json',
    });
    expect(sentValue.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(kafkaMessagesProducedTotal.inc).toHaveBeenCalledWith({
      topic: 'comment.created.dlq',
    });
  });

  it('publishToDeadLetterQueue shares the same connect-once/retry logic as publishCommentCreated', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn().mockResolvedValue(undefined);
    const producer = { connect, send, disconnect: jest.fn() };

    jest.doMock('../kafka/client', () => ({
      getKafka: () => ({ producer: () => producer }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const producerModule = require('../kafka/producer');
    const { publishCommentCreated, publishToDeadLetterQueue } = producerModule;

    await publishCommentCreated({ createdComment: { id: 1 }, postOwner: null });
    await publishToDeadLetterQueue('not-json', 'reason');

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
