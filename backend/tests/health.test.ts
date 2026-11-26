import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

function setup() {
  const findFirst = vi.fn().mockResolvedValue({ id: 1 });
  const database = { todo: { findFirst } } as never;
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { app, findFirst };
}
it('reports healthy after querying the database', async () => {
  const { app, findFirst } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'healthy' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('reports healthy when there are no tasks', async () => {
  const { app, findFirst } = setup();
  findFirst.mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'healthy' });
});
it('does not report healthy when the database fails', async () => {
  const { app, findFirst } = setup();
  findFirst.mockRejectedValue(new Error('db down'));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'healthy' });
});
