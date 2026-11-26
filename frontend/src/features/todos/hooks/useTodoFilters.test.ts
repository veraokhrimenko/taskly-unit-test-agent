import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const open = { ...todoFixture, id: 1, title: 'Write report' }
const done = { ...todoFixture, id: 2, title: 'Buy milk', completed: true }
const todos = [open, done]

it('starts with all todos, empty search and newest-first sort', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, open])
})

it('filters visible todos by status', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])

  act(() => result.current.setFilter('active'))
  expect(result.current.visible).toEqual([open])
})

it('filters visible todos by search text', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('MILK'))

  expect(result.current.search).toBe('MILK')
  expect(result.current.visible).toEqual([done])
})

it('returns no todos when nothing matches the search', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('nothing like this'))

  expect(result.current.visible).toEqual([])
})

it('sorts visible todos by priority', () => {
  const high = { ...open, priority: 'high' as const }
  const low = { ...done, priority: 'low' as const }
  const { result } = renderHook(() => useTodoFilters([low, high]))

  act(() => result.current.setSort('priority'))

  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([high, low])
})
