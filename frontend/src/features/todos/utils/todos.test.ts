import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  countHighPriority,
  formatDate,
  isOverdue,
  selectTodos,
  validateTodo,
} from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it.each([
    ['completed', [2]],
    ['active', [1, 3]],
    ['all', [3, 2, 1]],
  ] as const)('filters by status %s', (filter, ids) => {
    const todos = [
      { ...base, id: 1 },
      { ...base, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(
      selectTodos(todos, filter, '', 'priority')
        .map((t) => t.id)
        .sort(),
    ).toEqual([...ids].sort())
  })

  it('sorts by due date with undated tasks last and ties by newest id', () => {
    const late: Todo = { ...base, id: 1, due_date: '2026-12-01' }
    const early: Todo = { ...base, id: 2, due_date: '2026-11-01' }
    const none: Todo = { ...base, id: 3 }
    const tie: Todo = { ...base, id: 4, due_date: '2026-11-01' }
    expect(
      selectTodos([late, none, early, tie], 'all', '', 'due').map((t) => t.id),
    ).toEqual([4, 2, 1, 3])
  })

  it('sorts by newest creation time first, ties by higher id', () => {
    const old: Todo = { ...base, id: 1, created_at: '2026-09-01T00:00:00Z' }
    const recent: Todo = { ...base, id: 2 }
    const same: Todo = { ...base, id: 3 }
    expect(
      selectTodos([old, recent, same], 'all', '', 'newest').map((t) => t.id),
    ).toEqual([3, 2, 1])
  })

  it('breaks priority ties by higher id', () => {
    const a: Todo = { ...base, id: 1 }
    const b: Todo = { ...base, id: 2 }
    expect(selectTodos([a, b], 'all', '', 'priority').map((t) => t.id)).toEqual(
      [2, 1],
    )
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })
})

describe('validateTodo', () => {
  const valid = {
    title: 'Plan',
    description: '',
    priority: 'low' as const,
    due_date: null,
    completed: false,
  }

  it('returns no errors for valid input', () => {
    expect(validateTodo({ ...valid, due_date: '2026-02-28' })).toEqual({})
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
  ])('requires a title (%s)', (_name, title) => {
    expect(validateTodo({ ...valid, title })).toEqual({
      title: 'Enter a task title.',
    })
  })

  it('accepts a 120 character title and rejects 121', () => {
    expect(validateTodo({ ...valid, title: 'x'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...valid, title: 'x'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
  })

  it('accepts a 2000 character description and rejects 2001', () => {
    expect(validateTodo({ ...valid, description: 'x'.repeat(2000) })).toEqual(
      {},
    )
    expect(validateTodo({ ...valid, description: 'x'.repeat(2001) })).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it.each(['2026-02-30', '2026-13-01', '26-01-01', 'tomorrow'])(
    'rejects the invalid due date %s',
    (due_date) => {
      expect(validateTodo({ ...valid, due_date })).toEqual({
        due_date: 'Enter a valid date.',
      })
    },
  )

  it('reports several errors at once', () => {
    expect(
      Object.keys(
        validateTodo({ ...valid, title: '', due_date: 'bad' }),
      ).sort(),
    ).toEqual(['due_date', 'title'])
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  function at(date: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${date}T12:00:00`))
  }

  it('is overdue when an open task is due before today', () => {
    at('2026-11-10')
    expect(isOverdue({ ...base, due_date: '2026-11-09' })).toBe(true)
  })

  it('is not overdue when due today or later', () => {
    at('2026-11-10')
    expect(isOverdue({ ...base, due_date: '2026-11-10' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-11-11' })).toBe(false)
  })

  it('is not overdue when completed or without a due date', () => {
    at('2026-11-10')
    expect(
      isOverdue({ ...base, due_date: '2026-11-01', completed: true }),
    ).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
  })
})

describe('countHighPriority', () => {
  it('counts only open tasks with high priority', () => {
    const todos: Todo[] = [
      { ...base, id: 1, priority: 'high' },
      { ...base, id: 2, priority: 'high' },
      { ...base, id: 3, priority: 'high', completed: true },
      { ...base, id: 4, priority: 'medium' },
      { ...base, id: 5, priority: 'low' },
    ]
    expect(countHighPriority(todos)).toBe(2)
  })

  it('returns 0 for an empty list', () => {
    expect(countHighPriority([])).toBe(0)
  })

  it('returns 0 when every high priority task is completed', () => {
    expect(
      countHighPriority([
        { ...base, id: 1, priority: 'high', completed: true },
        { ...base, id: 2, priority: 'low' },
      ]),
    ).toBe(0)
  })
})

describe('formatDate', () => {
  it('formats an ISO date as day, short month and year', () => {
    expect(formatDate('2026-03-05')).toBe('5 Mar 2026')
  })
})
