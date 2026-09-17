import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { experienceRoutes } from './routes/experiences';
import { itineraryRoutes } from './routes/itineraries';
import { syncRoutes } from './routes/sync';
import { savedRoutes } from './routes/saved';
import { aiRoutes } from './routes/ai';

export function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
  });

  // Enable CORS
  fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', app: 'Roamly API', timestamp: new Date().toISOString() };
  });

  // Register API routes
  fastify.register(experienceRoutes);
  fastify.register(itineraryRoutes);
  fastify.register(syncRoutes);
  fastify.register(savedRoutes);
  fastify.register(aiRoutes);

  return fastify;
}

async function start() {
  const server = buildServer();
  const PORT = Number(process.env.PORT) || 3001;
  const HOST = process.env.HOST || '0.0.0.0';

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`Roamly Backend API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
