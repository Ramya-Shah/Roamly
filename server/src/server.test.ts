import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from './server';
import { FastifyInstance } from 'fastify';

describe('Fastify API Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns status ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('GET /categories returns category list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/categories',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories.length).toBeGreaterThanOrEqual(5);
  });

  it('GET /experiences returns experiences with city filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/experiences?city=Bengaluru',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.experiences.length).toBeGreaterThan(0);
    expect(body.experiences.every((e: any) => e.city === 'Bengaluru')).toBe(true);
  });

  it('GET /experiences/nearby returns distance-sorted experiences', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/experiences/nearby?lat=12.9716&lng=77.5946&radiusKm=30&city=Bengaluru',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.experiences.length).toBeGreaterThan(0);
    expect(body.experiences[0].distanceKm).toBeDefined();
  });

  it('POST /itineraries creates a day trip plan', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/itineraries',
      payload: {
        title: 'Saturday in Bengaluru Test',
        city: 'Bengaluru',
        date: '2026-09-19',
        startTime: '10:00',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.itinerary.id).toBeDefined();
    expect(body.itinerary.title).toBe('Saturday in Bengaluru Test');
  });

  it('POST /sync handles batch mutations with idempotency', async () => {
    const mutation = {
      id: 'test-mut-1',
      type: 'TOGGLE_SAVED',
      entityId: 'blr-palace',
      payload: { experienceId: 'blr-palace', isSaved: true },
      idempotencyKey: 'idemp-key-test-12345',
      createdAt: new Date().toISOString(),
    };

    // First attempt: should succeed
    const res1 = await app.inject({
      method: 'POST',
      url: '/sync',
      payload: { mutations: [mutation] },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    expect(body1.successfulIds).toContain('test-mut-1');

    // Second attempt (duplicate retry): should also succeed idempotently without error
    const res2 = await app.inject({
      method: 'POST',
      url: '/sync',
      payload: { mutations: [mutation] },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.successfulIds).toContain('test-mut-1');
  });
});
