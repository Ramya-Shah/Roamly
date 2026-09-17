import { FastifyInstance } from 'fastify';
import { geminiPlannerService } from '../services/geminiPlannerService';
import {
  PlanRequestSchema,
  RegenerateRequestSchema,
} from '../schemas/ai.schema';
import { memoryStore } from '../db/client';

export async function aiRoutes(fastify: FastifyInstance) {
  // POST /ai/plan - Generate a new AI plan
  fastify.post('/ai/plan', async (request, reply) => {
    const parseResult = PlanRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid plan request parameters',
        details: parseResult.error.format(),
      });
    }

    try {
      const plan = await geminiPlannerService.generatePlan(parseResult.data);
      return reply.status(201).send({
        success: true,
        plan,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Failed to generate plan',
        message: err.message || 'Unknown error',
      });
    }
  });

  // POST /ai/regenerate - Re-generate an existing plan with modifiers
  fastify.post('/ai/regenerate', async (request, reply) => {
    const parseResult = RegenerateRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid regenerate request parameters',
        details: parseResult.error.format(),
      });
    }

    try {
      const plan = await geminiPlannerService.regeneratePlan(parseResult.data);
      return reply.send({
        success: true,
        plan,
      });
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Failed to regenerate plan',
        message: err.message || 'Unknown error',
      });
    }
  });

  // GET /ai/plans - Get all generated plans
  fastify.get('/ai/plans', async (request, reply) => {
    const plans = Array.from(memoryStore.generatedPlans.values()).sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return reply.send({ plans });
  });

  // GET /ai/plans/:id - Get a specific generated plan
  fastify.get('/ai/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = memoryStore.generatedPlans.get(id);
    if (!plan) {
      return reply.status(404).send({ error: 'Plan not found' });
    }
    return reply.send({ plan });
  });

  // DELETE /ai/plans/:id - Delete a plan
  fastify.delete('/ai/plans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    memoryStore.generatedPlans.delete(id);
    return reply.send({ success: true });
  });
}
