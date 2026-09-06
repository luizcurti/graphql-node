import { Kafka, logLevel } from 'kafkajs';

let kafka: Kafka | null = null;
let attempted = false;

// Kafka is an optional, additive event backbone: when KAFKA_BROKERS isn't
// set, producer/consumer fall back to publishing straight onto the existing
// Redis/in-memory PubSub (see ../graphql/pubsub.ts).
export const getKafka = (): Kafka | null => {
  if (attempted) return kafka;
  attempted = true;

  if (!process.env.KAFKA_BROKERS) return null;

  kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'graphql-node',
    brokers: process.env.KAFKA_BROKERS.split(',').map((broker) =>
      broker.trim(),
    ),
    logLevel: logLevel.ERROR,
  });

  return kafka;
};
