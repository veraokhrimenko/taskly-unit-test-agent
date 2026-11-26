import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const done = {
  ...todoFixture,
  id: 2,
  title: 'Done thing',
  description: '',
  completed: true,
}
const open = {
  ...todoFixture,
  id: 3,
  title: 'Open thing',
  description: '',
  completed: false,
}

it('starts with all filter, empty search and newest sort', () => {
  const { result } = renderHook(() => useTodoFilters([done, open]))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toHaveLength(2)
})

it('narrows visible todos by status filter', () => {
  const { result } = renderHook(() => useTodoFilters([done, open]))

  act(() => result.current.setFilter('completed'))
  expect(result.current.visible.map((t) => t.id)).toEqual([2])

  act(() => result.current.setFilter('active'))
  expect(result.current.visible.map((t) => t.id)).toEqual([3])
})

it('narrows visible todos by search text', () => {
  const { result } = renderHook(() => useTodoFilters([done, open]))

  act(() => result.current.setSearch('OPEN'))

  expect(result.current.search).toBe('OPEN')
  expect(result.current.visible.map((t) => t.id)).toEqual([3])
})

it('shows nothing when the search matches no todo', () => {
  const { result } = renderHook(() => useTodoFilters([done, open]))

  act(() => result.current.setSearch('zzz'))

  expect(result.current.visible).toEqual([])
})

it('reorders visible todos when the sort changes', () => {
  const high = { ...open, id: 4, priority: 'high' as const }
  const low = { ...open, id: 5, priority: 'low' as const }
  const { result } = renderHook(() => useTodoFilters([low, high]))

  act(() => result.current.setSort('priority'))

  expect(result.current.sort).toBe('priority')
  expect(result.current.visible.map((t) => t.id)).toEqual([4, 5])
})
