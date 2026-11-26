import { Router } from 'express';
import type { Database } from '../features/todos/types.js';

export function createHealthRouter(database: Database) {
  const router = Router();
  router.get('/health', async (req, res) => {
    try {
      await database.todo.findFirst({ select: { id: true } });
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
}
