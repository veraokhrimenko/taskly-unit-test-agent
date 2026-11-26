import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    otherTitles,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    otherTitles?: string[]
  }) => (
    <>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      <p data-testid="other-titles">{JSON.stringify(otherTitles)}</p>
    </>
  ),
}))

function mockMutations() {
  const idle = { isPending: false, error: null, mutateAsync: vi.fn() }
  vi.mocked(useCreateTodoMutation).mockReturnValue(
    idle as unknown as ReturnType<typeof useCreateTodoMutation>,
  )
  vi.mocked(useUpdateTodoMutation).mockReturnValue(
    idle as unknown as ReturnType<typeof useUpdateTodoMutation>,
  )
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo="new"
      todos={[]}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('passes the titles of all tasks to the form when creating', () => {
  mockMutations()
  const todos = [
    { ...todoFixture, id: 1, title: 'One' },
    { ...todoFixture, id: 2, title: 'Two' },
  ]
  render(
    <TodoEditor
      todo="new"
      todos={todos}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByTestId('other-titles')).toHaveTextContent('["One","Two"]')
})

it('leaves out the title of the edited task so it is not a duplicate of itself', () => {
  mockMutations()
  const todos = [
    { ...todoFixture, id: 1, title: 'One' },
    { ...todoFixture, id: 2, title: 'Two' },
  ]
  render(
    <TodoEditor
      todo={todos[0]}
      todos={todos}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByTestId('other-titles')).toHaveTextContent('["Two"]')
})
