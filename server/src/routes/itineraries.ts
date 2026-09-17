import { FastifyInstance } from 'fastify';
import { serverItineraryRepo } from '../repositories/itineraryRepo';
import {
  CreateItineraryBodySchema,
  AddItineraryItemBodySchema,
  ItineraryParamSchema,
  ItineraryItemParamSchema,
} from '../schemas/itinerary.schema';

export async function itineraryRoutes(fastify: FastifyInstance) {
  // POST /itineraries
  fastify.post('/itineraries', async (request, reply) => {
    const parseResult = CreateItineraryBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const itinerary = await serverItineraryRepo.create(parseResult.data);
    return reply.status(201).send({ itinerary });
  });

  // GET /itineraries/:id
  fastify.get('/itineraries/:id', async (request, reply) => {
    const parseResult = ItineraryParamSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const itinerary = await serverItineraryRepo.getById(parseResult.data.id);
    if (!itinerary) {
      return reply.status(404).send({ error: 'Itinerary not found' });
    }

    return reply.send({ itinerary });
  });

  // POST /itineraries/:id/items
  fastify.post('/itineraries/:id/items', async (request, reply) => {
    const paramResult = ItineraryParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: paramResult.error.format() });
    }

    const bodyResult = AddItineraryItemBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: bodyResult.error.format() });
    }

    const item = await serverItineraryRepo.addItem(paramResult.data.id, bodyResult.data);
    if (!item) {
      return reply.status(404).send({ error: 'Itinerary not found' });
    }

    return reply.status(201).send({ item });
  });

  // DELETE /itineraries/:id/items/:itemId
  fastify.delete('/itineraries/:id/items/:itemId', async (request, reply) => {
    const parseResult = ItineraryItemParamSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const { id, itemId } = parseResult.data;
    const removed = await serverItineraryRepo.removeItem(id, itemId);
    return reply.send({ success: removed });
  });
}
