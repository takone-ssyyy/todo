/**
 * TODO App — Vanilla JS ES Module
 * Architecture: unidirectional data flow (action → reducer → render)
 */

// ============================================================
// Constants
// ============================================================
const STORAGE_KEY = 'todo-app-v1';

// ============================================================
// State
// ============================================================

/** @typedef {{ id: string, text: string, completed: boolean, createdAt: number }} Task */
/** @typedef {{ tasks: Task[], filter: 'all'|'active'|'completed', theme: 'light'|'dark' }} AppState */

/** @type {AppState} */
let state = loadState();

// ============================================================
// Persistence
// ============================================================

function defaultState() {
  return {
    tasks: [],
    filter: 'all',
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Basic schema validation
    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!['all', 'active', 'completed'].includes(parsed.filter)) parsed.filter = 'all';
    if (!['light', 'dark'].includes(parsed.theme)) parsed.theme = 'light';
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or private mode — silently ignore
  }
}

// ============================================================
// Reducer
// ============================================================

/**
 * @param {AppState} s
 * @param {{ type: string, [key: string]: any }} action
 * @returns {AppState}
 */
function reducer(s, action) {
  switch (action.type) {
    case 'ADD_TASK': {
      const text = action.text.trim();
      if (!text) return s;
      return {
        ...s,
        tasks: [
          ...s.tasks,
          { id: crypto.randomUUID(), text, completed: false, createdAt: Date.now() },
        ],
      };
    }
    case 'TOGGLE_TASK': {
      return {
        ...s,
        tasks: s.tasks.map(t =>
          t.id === action.id ? { ...t, completed: !t.completed } : t
        ),
      };
    }
    case 'DELETE_TASK': {
      return { ...s, tasks: s.tasks.filter(t => t.id !== action.id) };
    }
    case 'EDIT_TASK': {
      const text = action.text.trim();
      if (!text) return reducer(s, { type: 'DELETE_TASK', id: action.id });
      return {
        ...s,
        tasks: s.tasks.map(t => t.id === action.id ? { ...t, text } : t),
      };
    }
    case 'REORDER_TASKS': {
      const tasks = [...s.tasks];
      const srcIdx = tasks.findIndex(t => t.id === action.srcId);
      const tgtIdx = tasks.findIndex(t => t.id === action.targetId);
      if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return s;
      const [moved] = tasks.splice(srcIdx, 1);
      // After splice, if src was before tgt, tgt shifts left by 1
      const adjustedTgt = srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx;
      // action.before: insert before target; else insert after (end of list)
      const insertAt = action.before !== false ? adjustedTgt : adjustedTgt + 1;
      tasks.splice(insertAt, 0, moved);
      return { ...s, tasks };
    }
    case 'SET_FILTER': {
      return { ...s, filter: action.filter };
    }
    case 'CLEAR_COMPLETED': {
      return { ...s, tasks: s.tasks.filter(t => !t.completed) };
    }
    case 'SET_THEME': {
      return { ...s, theme: action.theme };
    }
    default:
      return s;
  }
}

// ============================================================
// Dispatch
// ============================================================

function dispatch(action) {
  state = reducer(state, action);
  saveState();
  render();
}

// ============================================================
// DOM References (cached once)
// ============================================================

const $ = id => document.getElementById(id);
const taskList    = $('task-list');
const itemsLeft   = $('items-left');
const emptyState  = $('empty-state');
const filterBtns  = document.querySelectorAll('.filter-btn');
const clearBtn    = $('clear-completed');
const addForm     = $('add-form');
const newTaskInput = $('new-task');
const themeToggle = $('theme-toggle');
const statusEl    = $('status');

// ============================================================
// Render
// ============================================================

function getVisibleTasks() {
  const { tasks, filter } = state;
  if (filter === 'active')    return tasks.filter(t => !t.completed);
  if (filter === 'completed') return tasks.filter(t =>  t.completed);
  return tasks;
}

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function render() {
  const visible = getVisibleTasks();
  const activeCount = state.tasks.filter(t => !t.completed).length;
  const completedCount = state.tasks.filter(t => t.completed).length;

  // ---- Task list (incremental DOM update) ----
  reconcileTaskList(visible);

  // ---- Footer counts ----
  itemsLeft.textContent = `${activeCount} 件残り`;

  // ---- Filter button states ----
  filterBtns.forEach(btn => {
    const isActive = btn.dataset.filter === state.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  // ---- Clear completed visibility ----
  clearBtn.style.visibility = completedCount > 0 ? 'visible' : 'hidden';

  // ---- Empty state ----
  const showEmpty = state.tasks.length === 0 || (visible.length === 0 && state.tasks.length > 0);
  emptyState.classList.toggle('visible', showEmpty);
  if (state.tasks.length === 0) {
    emptyState.textContent = '✨ タスクがありません。追加してみましょう！';
  } else if (visible.length === 0) {
    const labels = { active: '未完了', completed: '完了済み' };
    emptyState.textContent = `${labels[state.filter] || ''}のタスクはありません。`;
  }

  // ---- Task section visibility ----
  $('task-section').style.display = state.tasks.length > 0 ? '' : 'none';

  // ---- Theme ----
  document.documentElement.dataset.theme = state.theme;
}

// ============================================================
// Incremental DOM reconciliation
// ============================================================

function reconcileTaskList(visible) {
  const existingIds = new Set(
    [...taskList.querySelectorAll('.task-item')].map(el => el.dataset.id)
  );
  const visibleIds = new Set(visible.map(t => t.id));

  // Remove items no longer visible (with animation)
  taskList.querySelectorAll('.task-item').forEach(el => {
    if (!visibleIds.has(el.dataset.id)) {
      removeItemWithAnimation(el);
    }
  });

  // Add or update items
  visible.forEach((task, idx) => {
    let el = taskList.querySelector(`.task-item[data-id="${task.id}"]`);
    if (!el) {
      el = createTaskElement(task);
      taskList.appendChild(el);
    } else {
      updateTaskElement(el, task);
    }

    // Ensure correct DOM order
    const children = [...taskList.querySelectorAll('.task-item:not(.removing)')];
    const currentIdx = children.indexOf(el);
    if (currentIdx !== idx) {
      const ref = children[idx];
      if (ref && ref !== el) {
        taskList.insertBefore(el, ref);
      }
    }
  });
}

function removeItemWithAnimation(el) {
  if (el.classList.contains('removing')) return;
  el.classList.add('removing');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  // Fallback if animation doesn't fire
  setTimeout(() => el.remove(), 300);
}

function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.completed ? ' completed' : '');
  li.dataset.id = task.id;
  li.draggable = true;

  li.innerHTML = `
    <span class="drag-handle" aria-hidden="true">
      <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
        <circle cx="4" cy="4"  r="1.5"/>
        <circle cx="10" cy="4"  r="1.5"/>
        <circle cx="4" cy="10" r="1.5"/>
        <circle cx="10" cy="10" r="1.5"/>
        <circle cx="4" cy="16" r="1.5"/>
        <circle cx="10" cy="16" r="1.5"/>
      </svg>
    </span>
    <span class="task-checkbox-wrapper">
      <input
        type="checkbox"
        class="task-checkbox"
        id="cb-${task.id}"
        aria-label="${escapeHtml(task.text)}"
        ${task.completed ? 'checked' : ''}
      />
    </span>
    <label class="task-label" for="cb-${task.id}" tabindex="0">${escapeHtml(task.text)}</label>
    <button class="task-delete" aria-label="削除: ${escapeHtml(task.text)}">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    </button>
  `;

  attachTaskListeners(li, task);
  return li;
}

function updateTaskElement(el, task) {
  el.classList.toggle('completed', task.completed);
  const cb = el.querySelector('.task-checkbox');
  if (cb) cb.checked = task.completed;
  const label = el.querySelector('.task-label');
  if (label && label.getAttribute('contenteditable') !== 'true') {
    // Only update if not being edited
    if (label.textContent !== task.text) {
      label.textContent = task.text;
    }
  }
}

function attachTaskListeners(li, task) {
  const cb     = li.querySelector('.task-checkbox');
  const label  = li.querySelector('.task-label');
  const delBtn = li.querySelector('.task-delete');

  // Toggle complete
  cb.addEventListener('change', () => {
    dispatch({ type: 'TOGGLE_TASK', id: task.id });
    announceStatus(cb.checked ? 'タスク完了' : 'タスクを未完了に戻しました');
  });

  // Delete
  delBtn.addEventListener('click', () => {
    dispatch({ type: 'DELETE_TASK', id: task.id });
    announceStatus('タスクを削除しました');
    newTaskInput.focus();
  });

  // Inline edit: double-click or Enter on label
  label.addEventListener('dblclick', () => startEdit(label, task.id));
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      startEdit(label, task.id);
    }
  });

  // Drag & Drop
  li.addEventListener('dragstart', onDragStart);
  li.addEventListener('dragover',  onDragOver);
  li.addEventListener('dragleave', onDragLeave);
  li.addEventListener('drop',      onDrop);
  li.addEventListener('dragend',   onDragEnd);
}

// ============================================================
// Inline Edit
// ============================================================

function startEdit(label, taskId) {
  label.contentEditable = 'true';
  label.focus();

  // Move cursor to end
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(label);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  function commitEdit() {
    label.contentEditable = 'false';
    const newText = label.textContent.trim();
    dispatch({ type: 'EDIT_TASK', id: taskId, text: newText });
  }

  label.addEventListener('blur',   commitEdit, { once: true });
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      label.blur();
    }
    if (e.key === 'Escape') {
      label.contentEditable = 'false';
      // Restore original text without saving
      const task = state.tasks.find(t => t.id === taskId);
      if (task) label.textContent = task.text;
    }
  });
}

// ============================================================
// Drag & Drop
// ============================================================

let dragSrcId = null;

function onDragStart(e) {
  dragSrcId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (this.dataset.id === dragSrcId) return;

  const rect = this.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  this.classList.remove('drag-over-top', 'drag-over-bottom');
  this.classList.add(e.clientY < midY ? 'drag-over-top' : 'drag-over-bottom');
}

function onDragLeave() {
  this.classList.remove('drag-over-top', 'drag-over-bottom');
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over-top', 'drag-over-bottom');
  if (!dragSrcId || this.dataset.id === dragSrcId) return;

  const rect = this.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  dispatch({ type: 'REORDER_TASKS', srcId: dragSrcId, targetId: this.dataset.id, before: insertBefore });
}

function onDragEnd() {
  this.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  taskList.querySelectorAll('.task-item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging');
  });
  dragSrcId = null;
}


// ============================================================
// Accessibility
// ============================================================

function announceStatus(msg) {
  statusEl.textContent = '';
  requestAnimationFrame(() => { statusEl.textContent = msg; });
}

// ============================================================
// Utilities
// ============================================================

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// Event Wiring
// ============================================================

// Add task
addForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = newTaskInput.value;
  if (!text.trim()) return;
  dispatch({ type: 'ADD_TASK', text });
  newTaskInput.value = '';
  announceStatus('タスクを追加しました');
  newTaskInput.focus();
});

// Filter buttons
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    dispatch({ type: 'SET_FILTER', filter: btn.dataset.filter });
  });
});

// Clear completed
clearBtn.addEventListener('click', () => {
  const count = state.tasks.filter(t => t.completed).length;
  if (count === 0) return;
  dispatch({ type: 'CLEAR_COMPLETED' });
  announceStatus(`完了済みの ${count} 件を削除しました`);
});

// Theme toggle
themeToggle.addEventListener('click', () => {
  const next = state.theme === 'light' ? 'dark' : 'light';
  dispatch({ type: 'SET_THEME', theme: next });
});

// Keyboard shortcut: Escape to blur input
newTaskInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') newTaskInput.blur();
});

// ============================================================
// Initial render
// ============================================================

render();

// Focus input on load
newTaskInput.focus();
