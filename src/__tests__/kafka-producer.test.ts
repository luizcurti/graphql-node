describe('kafka producer', () => {
  const publishMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    publishMock.mockClear();
    jest.doMock('../graphql/pubsub', () => ({
      pubSub: { publish: publishMock },
      CREATED_COMMENT_TRIGGER: 'CREATED_COMMENT',
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

    await disconnectProducer();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
