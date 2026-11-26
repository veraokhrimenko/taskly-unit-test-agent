import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const done = { ...todoFixture, id: 8, title: 'Ship release', completed: true }
const todos = [todoFixture, done]

it('starts with all todos, no search and newest-first sorting', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible.map((t) => t.id)).toEqual([8, 7])
})

it('narrows the visible todos when the filter changes', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])

  act(() => result.current.setFilter('active'))
  expect(result.current.visible).toEqual([todoFixture])
})

it('narrows the visible todos by search text and shows none without a match', () => {
  const { result } = renderHook(() => useTodoFilters(todos))

  act(() => result.current.setSearch('RELEASE'))
  expect(result.current.visible).toEqual([done])

  act(() => result.current.setSearch('nothing like this'))
  expect(result.current.visible).toEqual([])
})

it('reorders the visible todos when the sort changes', () => {
  const high = { ...todoFixture, id: 9, priority: 'high' as const }
  const { result } = renderHook(() => useTodoFilters([todoFixture, high]))

  act(() => result.current.setSort('priority'))

  expect(result.current.sort).toBe('priority')
  expect(result.current.visible.map((t) => t.id)).toEqual([9, 7])
})
