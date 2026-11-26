import { Router } from 'express';
import type { TodoStore } from './types.js';
import { createSchema, updateSchema, idSchema } from './validators.js';

const duplicateTitle = 'A task with this title already exists.';

export function createTodosRouter(repository: TodoStore) {
  const router = Router();
  router.param('id', (req, res, next, id) => {
    const result = idSchema.safeParse(id);
    if (!result.success) return res.status(422).json({ detail: result.error.issues });
    res.locals.todoId = result.data;
    next();
  });
  router.get('/', async (req, res) => res.json(await repository.list()));
  router.post('/', async (req, res) => {
    const result = createSchema.safeParse(req.body);
    if (!result.success) return res.status(422).json({ detail: result.error.issues });
    if (await repository.titleExists(result.data.title)) return res.status(409).json({ detail: duplicateTitle });
    res.status(201).json(await repository.create(result.data));
  });
  router.get('/:id', async (req, res) => {
    const todo = await repository.get(Number(res.locals.todoId));
    if (!todo) return res.status(404).json({ detail: 'Task not found.' });
    res.json(todo);
  });
  router.patch('/:id', async (req, res) => {
    const result = updateSchema.safeParse(req.body);
    if (!result.success) return res.status(422).json({ detail: result.error.issues });
    const id = Number(res.locals.todoId);
    if (result.data.title !== undefined && await repository.titleExists(result.data.title, id)) {
      return res.status(409).json({ detail: duplicateTitle });
    }
    const todo = await repository.update(id, result.data);
    if (!todo) return res.status(404).json({ detail: 'Task not found.' });
    res.json(todo);
  });
  router.delete('/:id', async (req, res) => {
    if (!await repository.delete(Number(res.locals.todoId))) return res.status(404).json({ detail: 'Task not found.' });
    res.status(204).end();
  });
  return router;
}
