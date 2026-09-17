import { FastifyInstance } from 'fastify';
import { syncService } from '../services/syncService';
import { SyncBatchBodySchema } from '../schemas/sync.schema';

export async function syncRoutes(fastify: FastifyInstance) {
  // POST /sync
  fastify.post('/sync', async (request, reply) => {
    const parseResult = SyncBatchBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const { mutations } = parseResult.data;
    const result = await syncService.processBatch(mutations);
    return reply.send(result);
  });
}
