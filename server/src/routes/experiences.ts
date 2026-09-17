import { FastifyInstance } from 'fastify';
import { serverExperienceRepo } from '../repositories/experienceRepo';
import {
  GetExperiencesQuerySchema,
  GetNearbyQuerySchema,
  ExperienceParamSchema,
} from '../schemas/experience.schema';

export async function experienceRoutes(fastify: FastifyInstance) {
  // GET /experiences
  fastify.get('/experiences', async (request, reply) => {
    const parseResult = GetExperiencesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const filters = parseResult.data;
    const experiences = await serverExperienceRepo.getExperiences(filters);
    return reply.send({ experiences });
  });

  // GET /experiences/nearby
  fastify.get('/experiences/nearby', async (request, reply) => {
    const parseResult = GetNearbyQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const { lat, lng, radiusKm, city } = parseResult.data;
    const experiences = await serverExperienceRepo.getNearby(lat, lng, radiusKm, city);
    return reply.send({ experiences });
  });

  // GET /categories
  fastify.get('/categories', async (request, reply) => {
    const categories = await serverExperienceRepo.getCategories();
    return reply.send({ categories });
  });

  // GET /experiences/:id
  fastify.get('/experiences/:id', async (request, reply) => {
    const parseResult = ExperienceParamSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const experience = await serverExperienceRepo.getById(parseResult.data.id);
    if (!experience) {
      return reply.status(404).send({ error: 'Experience not found' });
    }

    return reply.send({ experience });
  });
}
