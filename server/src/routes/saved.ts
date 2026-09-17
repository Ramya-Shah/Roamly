import { FastifyInstance } from 'fastify';
import { serverSavedRepo } from '../repositories/savedRepo';
import { SavedExperienceBodySchema } from '../schemas/sync.schema';

export async function savedRoutes(fastify: FastifyInstance) {
  // POST /saved-experiences
  fastify.post('/saved-experiences', async (request, reply) => {
    const parseResult = SavedExperienceBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const { experienceId, isSaved } = parseResult.data;
    const result = await serverSavedRepo.toggleSaved('default-user', experienceId, isSaved);
    return reply.send({ success: true, result });
  });

  // GET /saved-experiences
  fastify.get('/saved-experiences', async (request, reply) => {
    const saved = await serverSavedRepo.getSaved('default-user');
    return reply.send({ saved });
  });
}
