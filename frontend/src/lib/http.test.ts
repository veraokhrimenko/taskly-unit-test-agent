import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

function respond(status: number, body?: unknown, jsonFails = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jsonFails
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(body),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('prefixes the path with /api and sends JSON headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, [{ id: 1 }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      request('/todos', { method: 'POST', headers: { 'X-Test': '1' } }),
    ).resolves.toEqual([{ id: 1 }])
    expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
    })
  })

  it('returns undefined for an empty 204 response', async () => {
    const response = respond(204)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(request('/todos/1')).resolves.toBeUndefined()
    expect(response.json).not.toHaveBeenCalled()
  })

  it('shows a validation hint for a 422 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(422, { detail: 'ignored' })),
    )
    await expect(request('/todos')).rejects.toThrow(
      'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
    )
  })

  it('uses the string detail of an error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(404, { detail: 'Task not found.' })),
    )
    await expect(request('/todos/9')).rejects.toThrow('Task not found.')
  })

  it.each([
    ['a non-string detail', respond(500, { detail: [{ msg: 'x' }] })],
    ['a body that is not JSON', respond(500, undefined, true)],
  ])('falls back to a generic message for %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('reports a connection problem when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(request('/todos')).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('rethrows the original error when the request was aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('Aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
      abortError,
    )
  })
})
