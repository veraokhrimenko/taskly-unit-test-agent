import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), titleExists: vi.fn().mockResolvedValue(false) };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it('returns a task by id', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when the task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/5');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each(['abc', '0', '-1', '1.5'])('rejects invalid id %s with 422', async (id) => {
  const { app, repository } = setup();
  const response = await request(app).get(`/api/todos/${id}`);
  expect(response.status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
});
it('updates a task with the validated fields', async () => {
  const { app, repository } = setup();
  const updated = { ...todo, completed: true };
  repository.update.mockResolvedValue(updated);
  const response = await request(app).patch('/api/todos/1').send({ completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(updated);
  expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
});
it('returns 404 when updating a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/9').send({ title: 'New' });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each([{}, { title: '' }, { priority: 'urgent' }, { unknown: 1 }])(
  'rejects invalid update input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).patch('/api/todos/1').send(payload)).status).toBe(422);
    expect(repository.update).not.toHaveBeenCalled();
  },
);
it('deletes a task and returns 204 with no body', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/3');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(3);
});
it('returns 404 when deleting a missing task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(false);
  const response = await request(app).delete('/api/todos/3');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('returns 409 and does not create a task when the title already exists', async () => {
  const { app, repository } = setup();
  repository.titleExists.mockResolvedValue(true);
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ' });
  expect(response.status).toBe(409);
  expect(response.body).toEqual({ detail: 'A task with this title already exists.' });
  expect(repository.titleExists).toHaveBeenCalledWith('Plan the sprint');
  expect(repository.create).not.toHaveBeenCalled();
});
it('does not check titles when create input is invalid', async () => {
  const { app, repository } = setup();
  expect((await request(app).post('/api/todos').send({ title: '  ' })).status).toBe(422);
  expect(repository.titleExists).not.toHaveBeenCalled();
});
it('returns 409 and does not update when renaming to the title of another task', async () => {
  const { app, repository } = setup();
  repository.titleExists.mockResolvedValue(true);
  const response = await request(app).patch('/api/todos/4').send({ title: 'Taken' });
  expect(response.status).toBe(409);
  expect(response.body).toEqual({ detail: 'A task with this title already exists.' });
  expect(repository.titleExists).toHaveBeenCalledWith('Taken', 4);
  expect(repository.update).not.toHaveBeenCalled();
});
it('updates the title when no other task uses it, excluding the task itself', async () => {
  const { app, repository } = setup();
  const updated = { ...todo, title: 'Own title' };
  repository.update.mockResolvedValue(updated);
  const response = await request(app).patch('/api/todos/1').send({ title: 'Own title' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(updated);
  expect(repository.titleExists).toHaveBeenCalledWith('Own title', 1);
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'Own title' });
});
it('skips the title check when an update does not change the title', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(todo);
  expect((await request(app).patch('/api/todos/1').send({ description: 'More' })).status).toBe(200);
  expect(repository.titleExists).not.toHaveBeenCalled();
});
