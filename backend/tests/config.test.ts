import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const keys = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];

function setup(values: Record<string, string> = {}) {
  for (const key of keys) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
beforeEach(() => setup());
afterEach(() => vi.unstubAllEnvs());

const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'pass', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'taskly' };

it('prefers the explicit override over the environment', () => {
  setup({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
});
it('uses DATABASE_URL when no override is given', () => {
  setup({ DATABASE_URL: 'postgresql://env/db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://env/db');
});
it('rewrites the postgresql+psycopg scheme to postgresql', () => {
  expect(resolveDatabaseUrl('postgresql+psycopg://u:p@h:1/d')).toBe('postgresql://u:p@h:1/d');
});
it('builds the URL from the individual variables', () => {
  setup(parts);
  expect(resolveDatabaseUrl()).toBe('postgresql://user:pass@db:5432/taskly');
});
it('encodes special characters in credentials and database name', () => {
  setup({ ...parts, POSTGRES_PASSWORD: 'p@ss/word', POSTGRES_DB: 'my db' });
  const url = new URL(resolveDatabaseUrl());
  expect(url.password).toBe('p%40ss%2Fword');
  expect(url.pathname).toBe('/my%20db');
});
it.each(Object.keys(parts))('throws when %s is missing', (name) => {
  setup({ ...parts, [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
