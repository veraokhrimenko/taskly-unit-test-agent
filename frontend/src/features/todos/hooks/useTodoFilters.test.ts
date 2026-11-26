import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const older = {
  ...todoFixture,
  id: 1,
  title: 'Write report',
  created_at: '2026-09-01T12:00:00Z',
}
const newer = {
  ...todoFixture,
  id: 2,
  title: 'Buy milk',
  completed: true,
  priority: 'high' as const,
  created_at: '2026-10-01T12:00:00Z',
}
const todos = [older, newer]

it('starts with all todos, newest first', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible.map((t) => t.id)).toEqual([2, 1])
})

it('shows only completed todos when the filter changes', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setFilter('completed'))

  expect(result.current.visible).toEqual([newer])
})

it('narrows the list by search text', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('REPORT'))

  expect(result.current.visible).toEqual([older])
})

it('shows nothing when the search matches no todo', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('zzz'))

  expect(result.current.visible).toEqual([])
})

it('sorts by priority when the sort changes', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSort('priority'))

  expect(result.current.visible.map((t) => t.id)).toEqual([2, 1])
})

it('updates the visible list when the todos prop changes', () => {
  const { result, rerender } = renderHook(({ list }) => useTodoFilters(list), {
    initialProps: { list: [older] },
  })

  rerender({ list: todos })

  expect(result.current.visible).toHaveLength(2)
})
