import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const done = { ...todoFixture, id: 8, title: 'Write report', completed: true }
const todos = [todoFixture, done]

it('starts with all todos, no search and newest first', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible.map((t) => t.id)).toEqual([8, 7])
})

it('shows only completed todos when the filter changes', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setFilter('completed'))

  expect(result.current.filter).toBe('completed')
  expect(result.current.visible).toEqual([done])
})

it('narrows the visible todos by the search text', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('REPORT'))

  expect(result.current.visible).toEqual([done])
})

it('returns no todos when nothing matches the search', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('zzz'))

  expect(result.current.visible).toEqual([])
})

it('orders by priority when the sort changes', () => {
  const high = { ...todoFixture, id: 9, priority: 'high' as const }
  const { result } = renderHook(() => useTodoFilters([todoFixture, high]))

  act(() => result.current.setSort('priority'))

  expect(result.current.visible.map((t) => t.id)).toEqual([9, 7])
})

it('updates the visible todos when the input list changes', () => {
  const { result, rerender } = renderHook(({ list }) => useTodoFilters(list), {
    initialProps: { list: [todoFixture] },
  })

  rerender({ list: todos })

  expect(result.current.visible).toHaveLength(2)
})
