import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

function setup() {
  const database = { todo: { findFirst: vi.fn().mockResolvedValue(null) } };
  const app = express();
  app.use('/api', createHealthRouter(database as never));
  return { app, database };
}
it('reports ok when the database answers, even with no tasks', async () => {
  const { app, database } = setup();
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(database.todo.findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('reports ok when the database returns a task', async () => {
  const { app, database } = setup();
  database.todo.findFirst.mockResolvedValue({ id: 1 });
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});
it('only answers GET requests on /health', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/health');
  expect(response.status).toBe(404);
});
