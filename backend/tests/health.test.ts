import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

function setup() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const database = { todo: { findFirst } } as never;
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { app, findFirst };
}

it('returns status ok when the database answers', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});

it('checks the database with a minimal query', async () => {
  const { app, findFirst } = setup();
  await request(app).get('/api/health');
  expect(findFirst).toHaveBeenCalledOnce();
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('returns 404 for unknown paths on the router', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(404);
});
