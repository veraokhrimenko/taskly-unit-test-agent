import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { TodoInput } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))

const input: TodoInput = {
  title: 'Prepare a demo',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  return { queryClient, result }
}

beforeEach(() => {
  vi.mocked(todosApi.create).mockReset()
})

it('puts the created todo first in the cached list', async () => {
  const older = { ...todoFixture, id: 1, title: 'Older' }
  const saved = { ...todoFixture, id: 2, title: 'New' }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { queryClient, result } = setup()
  queryClient.setQueryData(todoKeys.list, [older])

  await act(() => result.current.mutateAsync(input))

  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved, older])
})

it('creates the list when nothing is cached yet', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { queryClient, result } = setup()

  await act(() => result.current.mutateAsync(input))

  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('does not duplicate a todo that is already cached', async () => {
  const saved = { ...todoFixture, title: 'Server version' }
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { queryClient, result } = setup()
  queryClient.setQueryData(todoKeys.list, [todoFixture])

  await act(() => result.current.mutateAsync(input))

  expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved])
})

it('leaves the cached list unchanged when creating fails', async () => {
  vi.mocked(todosApi.create).mockRejectedValue(new Error('boom'))
  const { queryClient, result } = setup()
  queryClient.setQueryData(todoKeys.list, [todoFixture])

  act(() => result.current.mutate(input))

  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
