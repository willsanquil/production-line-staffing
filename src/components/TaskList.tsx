import type { TaskItem } from '../types';
import { createEmptyTask } from '../data/initialState';

interface TaskListProps {
  tasks: TaskItem[];
  onChange: (tasks: TaskItem[]) => void;
  placeholder?: string;
  compact?: boolean;
}

export function TaskList({ tasks, onChange, placeholder = 'Add task...', compact }: TaskListProps) {
  function addTask() {
    onChange([...tasks, createEmptyTask()]);
  }

  function updateTask(id: string, updates: Partial<TaskItem>) {
    onChange(
      tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }

  function removeTask(id: string) {
    onChange(tasks.filter((t) => t.id !== id));
  }

  return (
    <div className={compact ? 'task-list-compact' : ''}>
      <ul className="task-list">
        {tasks.map((t) => (
          <li key={t.id} className="task-list-item">
            <input
              type="checkbox"
              checked={t.done}
              onChange={(e) => updateTask(t.id, { done: e.target.checked })}
              aria-label="Done"
            />
            <span className={t.done ? 'done' : ''} style={{ flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={t.text}
                onChange={(e) => updateTask(t.id, { text: e.target.value })}
                placeholder={placeholder}
                className="task-list-input"
                style={{ width: '100%', minWidth: 60, fontSize: 'inherit' }}
              />
            </span>
            <button type="button" onClick={() => removeTask(t.id)} aria-label="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addTask} style={{ marginTop: 4 }}>
        + Add task
      </button>
    </div>
  );
}
