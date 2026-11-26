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
it('reports ok after querying the database', async () => {
  const { app, findFirst } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('does not report ok when the database is unavailable', async () => {
  const { app, findFirst } = setup();
  findFirst.mockRejectedValue(new Error('db down'));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'ok' });
});
