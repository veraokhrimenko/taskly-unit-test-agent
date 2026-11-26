import { it, expect, vi } from 'vitest';
import { initialize } from '../src/core/database.ts';

function setup() {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  return { database: { $executeRaw } as never, $executeRaw };
}
it('creates the todos table if it does not exist', async () => {
  const { database, $executeRaw } = setup();
  await expect(initialize(database)).resolves.toBeUndefined();
  expect($executeRaw).toHaveBeenCalledOnce();
  const sql = ($executeRaw.mock.calls[0][0] as string[]).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain("priority IN ('low', 'medium', 'high')");
});
it('propagates database errors', async () => {
  const { database, $executeRaw } = setup();
  $executeRaw.mockRejectedValue(new Error('connection refused'));
  await expect(initialize(database)).rejects.toThrow('connection refused');
});
