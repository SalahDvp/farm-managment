'use client'

// Tasks & reminders: rows, the create/edit form, the full Tasks screen, the
// top-bar bell, and the compact overview panel. Completing a task can record
// the matching input on its item and schedules the next repeat.

import { useMemo, useState, type ReactNode } from 'react'
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CircleCheck,
  Flag,
  ListChecks,
  Loader2,
  MapPin,
  Plus,
  Repeat as RepeatIcon,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  PRIORITIES,
  REPEATS,
  TASK_TYPES,
  todayISO,
  type CompleteTaskResult,
  type CreateTaskInput,
  type Item,
  type Priority,
  type Repeat,
  type Task,
  type TaskType,
} from '@/lib/farm-types'
import { dueInfo, fmt, formatDate, TASK_META, TYPE_META, type Translate } from '@/lib/ui'
import { useI18n } from '@/components/language-provider'
import { useToast } from '@/components/toast-provider'
import { useConfirm } from '@/components/confirm-provider'
import { useAllItems, useFields, useRefresh, useTasks } from '@/components/data-hooks'
import { FormSection, Segmented } from '@/components/form-kit'
import { apiFetch } from '@/lib/client-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tasks that belong to the active field (directly, or through their item). */
export function tasksInScope(tasks: Task[], items: Item[], fieldId: string): Task[] {
  if (fieldId === 'all') return tasks
  const itemField = new Map(items.map((i) => [i.id, i.fieldId]))
  return tasks.filter((t) => t.fieldId === fieldId || (t.itemId !== undefined && itemField.get(t.itemId) === fieldId))
}

function sortOpen(tasks: Task[]): Task[] {
  const rank: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
  return [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || rank[a.priority] - rank[b.priority])
}

export function useTaskActions() {
  const { t, locale } = useI18n()
  const { toast } = useToast()
  const refresh = useRefresh()

  const toggle = async (task: Task, itemName?: string) => {
    try {
      if (!task.done) {
        const res = await apiFetch(`/api/tasks/${task.id}/complete`, { method: 'POST' })
        if (!res.ok) throw new Error('complete failed')
        const data: CompleteTaskResult = await res.json()
        let message = data.logged && itemName ? t('toast.taskDoneLogged', { name: itemName }) : t('toast.taskDone')
        if (data.next) message += ` · ${t('toast.nextScheduled', { date: formatDate(data.next.dueDate, locale) })}`
        toast(message)
      } else {
        const res = await apiFetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: false }),
        })
        if (!res.ok) throw new Error('reopen failed')
        toast(t('toast.taskReopened'), 'info')
      }
      refresh()
    } catch {
      toast(t('toast.error'), 'error')
    }
  }

  return { toggle }
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export function TaskRow({ task, item, fieldName, onToggle, onOpen, compact }: {
  task: Task
  item?: Item
  fieldName?: string
  onToggle: () => void
  onOpen: () => void
  compact?: boolean
}) {
  const { t, locale } = useI18n()
  const meta = TASK_META[task.type]
  const TypeIcon = meta.icon
  const due = dueInfo(task.dueDate, t, locale)
  const ItemIcon = item ? TYPE_META[item.itemType].icon : null
  const duePill = (
    <span className={`due-pill ${task.done ? 'done' : due.state}`}>
      {task.done ? <CircleCheck /> : <CalendarClock />}
      {task.done ? formatDate(task.doneAt, locale) : due.label}
    </span>
  )
  return (
    <div className={`task-row${task.done ? ' done' : ''}${compact ? ' compact' : ''}`}>
      <button
        className={task.done ? 'task-check checked' : 'task-check'}
        onClick={onToggle}
        aria-label={task.done ? t('task.reopen') : t('task.complete')}
        title={task.done ? t('task.reopen') : t('task.complete')}
      >
        {task.done && <Check />}
      </button>
      <button className="task-main" onClick={onOpen}>
        <span className={`task-type-ic ${meta.tone}`}><TypeIcon /></span>
        <span className="task-text">
          <strong>{task.title}</strong>
          <span className="task-meta">
            {compact && duePill}
            {item && ItemIcon && <span className="chip-mini"><ItemIcon />{item.name}</span>}
            {!item && fieldName && <span className="chip-mini"><MapPin />{fieldName}</span>}
            {task.repeat !== 'none' && !compact && <span className="chip-mini"><RepeatIcon />{t(`repeat.${task.repeat}`)}</span>}
            {task.priority === 'high' && <span className="chip-mini high"><Flag />{t('priority.high')}</span>}
          </span>
        </span>
        {!compact && duePill}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

export function TaskFormModal({ mode, task, prefill, onClose }: {
  mode: 'create' | 'edit'
  task?: Task
  prefill?: Partial<CreateTaskInput>
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { toast } = useToast()
  const refresh = useRefresh()
  const items = useAllItems()
  const { fields } = useFields()

  const [title, setTitle] = useState(task?.title ?? prefill?.title ?? '')
  const [type, setType] = useState<TaskType>(task?.type ?? prefill?.type ?? 'other')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? prefill?.dueDate ?? todayISO())
  const [repeat, setRepeat] = useState<Repeat>(task?.repeat ?? prefill?.repeat ?? 'none')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? prefill?.priority ?? 'normal')
  const [itemId, setItemId] = useState(task?.itemId ?? prefill?.itemId ?? '')
  const [fieldId, setFieldId] = useState(task?.fieldId ?? prefill?.fieldId ?? '')
  const [notes, setNotes] = useState(task?.notes ?? prefill?.notes ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const grouped = useMemo(() => {
    const groups: Record<string, Item[]> = { animal: [], tree: [], resource: [] }
    for (const i of items) groups[i.itemType].push(i)
    return groups
  }, [items])

  const submit = async () => {
    if (!dueDate) {
      setError(t('err.dueRequired'))
      return
    }
    setSaving(true)
    setError('')
    const body = { title: title.trim() || t(`task.type.${type}`), type, dueDate, repeat, priority, itemId, fieldId, notes }
    try {
      const res = await apiFetch(mode === 'create' ? '/api/tasks' : `/api/tasks/${task!.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('err.saveFailed'))
        return
      }
      toast(mode === 'create' ? t('toast.taskAdded') : t('toast.taskUpdated'))
      refresh()
      onClose()
    } catch {
      setError(t('err.network'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!task) return
    const ok = await confirm({
      title: t('task.confirmDelete'),
      message: t('task.delete.body', { title: task.title }),
      confirmLabel: t('action.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      toast(t('toast.taskDeleted'))
      refresh()
      onClose()
    } catch {
      toast(t('toast.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onClick={(e) => e.stopPropagation()}>
        <header className="form-head">
          <div className="modal-icon"><ListChecks /></div>
          <div className="form-head-text">
            <h2 id="task-form-title">{mode === 'create' ? t('task.new') : t('task.edit')}</h2>
            <p>{t('task.formSub')}</p>
          </div>
          <button className="form-close" onClick={onClose} aria-label={t('action.cancel')}><X /></button>
        </header>

        <div className="form-body">
          <FormSection icon={Tag} title={t('task.type')}>
            <div className="task-type-grid">
              {TASK_TYPES.map((k) => {
                const meta = TASK_META[k]
                const Icon = meta.icon
                return (
                  <button key={k} type="button" className={type === k ? `kind-chip ${meta.tone} selected` : `kind-chip ${meta.tone}`} onClick={() => setType(k)}>
                    <Icon />
                    <span>{t(`task.type.${k}`)}</span>
                  </button>
                )
              })}
            </div>
          </FormSection>

          <FormSection icon={CalendarDays} title={t('task.when')}>
            <div className="form-grid">
              <label className="span-2">{t('task.titleLabel')}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(`task.type.${type}`)} /></label>
              <label>{t('task.due')}<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
              <div className="form-field">
                <span className="form-label">{t('task.priority')}</span>
                <Segmented<Priority>
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), tone: p === 'high' ? 'rose' : p === 'low' ? 'gray' : undefined }))}
                />
              </div>
              <div className="form-field span-2">
                <span className="form-label">{t('task.repeat')}</span>
                <Segmented<Repeat> value={repeat} onChange={setRepeat} options={REPEATS.map((r) => ({ value: r, label: t(`repeat.${r}`) }))} />
              </div>
            </div>
          </FormSection>

          <FormSection icon={MapPin} title={t('task.linkTitle')} hint={t('task.linkHint')} optional>
            <div className="form-grid">
              <label>
                {t('task.item')}
                <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">{t('task.noLink')}</option>
                  {(['animal', 'tree', 'resource'] as const).map((group) =>
                    grouped[group].length > 0 ? (
                      <optgroup key={group} label={t(`type.${group}`)}>
                        {grouped[group].map((i) => <option key={i.id} value={i.id}>{i.name} · {i.id}</option>)}
                      </optgroup>
                    ) : null,
                  )}
                </select>
              </label>
              <label>
                {t('task.field')}
                <select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
                  <option value="">{t('task.noLink')}</option>
                  {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="span-2">{t('task.notes')} <em>{t('field.optional')}</em><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('ph.task.notes')} /></label>
            </div>
          </FormSection>
        </div>

        <footer className="form-foot">
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-foot-actions">
            {mode === 'edit' && (
              <button className="ghost-button danger" onClick={remove} disabled={saving}><Trash2 />{t('task.delete')}</button>
            )}
            <button className="cancel-button" onClick={onClose} disabled={saving}>{t('action.cancel')}</button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              {saving ? <><Loader2 className="spin" data-icon="inline-start" />{t('action.saving')}</> : <><Check data-icon="inline-start" />{mode === 'create' ? t('task.create') : t('action.saveChanges')}</>}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared list rendering
// ---------------------------------------------------------------------------

function TaskList({ tasks, onEdit, compact, empty }: { tasks: Task[]; onEdit: (task: Task) => void; compact?: boolean; empty?: ReactNode }) {
  const items = useAllItems()
  const { fields } = useFields()
  const { toggle } = useTaskActions()
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const fieldName = useMemo(() => new Map(fields.map((f) => [f.id, f.name])), [fields])
  if (tasks.length === 0) return <>{empty ?? null}</>
  return (
    <div className="task-list">
      {tasks.map((task) => {
        const item = task.itemId ? itemById.get(task.itemId) : undefined
        return (
          <TaskRow
            key={task.id}
            task={task}
            item={item}
            fieldName={task.fieldId ? fieldName.get(task.fieldId) : undefined}
            onToggle={() => toggle(task, item?.name)}
            onOpen={() => onEdit(task)}
            compact={compact}
          />
        )
      })}
    </div>
  )
}

/** Tasks linked to one item — used inside the item drawer. */
export function ItemTasks({ itemId, onEdit, onNew }: { itemId: string; onEdit: (task: Task) => void; onNew: () => void }) {
  const { t } = useI18n()
  const { tasks } = useTasks()
  const [showDone, setShowDone] = useState(false)
  const mine = tasks.filter((task) => task.itemId === itemId)
  const open = sortOpen(mine.filter((task) => !task.done))
  const done = mine.filter((task) => task.done)
  return (
    <div className="item-tasks">
      <button className="ghost-button full" onClick={onNew}><Plus />{t('drawer.addTask')}</button>
      <TaskList tasks={open} onEdit={onEdit} empty={<p className="detail-empty">{t('tasks.noneForItem')}</p>} />
      {done.length > 0 && (
        <>
          <button className="text-button" onClick={() => setShowDone((s) => !s)}>{showDone ? t('tasks.hideDone') : t('tasks.showDone', { n: done.length })}</button>
          {showDone && <TaskList tasks={done} onEdit={onEdit} />}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tasks screen
// ---------------------------------------------------------------------------

function groupOpen(tasks: Task[], t: Translate) {
  const today = todayISO()
  const inWeek = todayISO(new Date(Date.now() + 7 * 86400000))
  const groups: { key: string; label: string; tasks: Task[] }[] = [
    { key: 'overdue', label: t('tasks.overdue'), tasks: [] },
    { key: 'today', label: t('tasks.today'), tasks: [] },
    { key: 'week', label: t('tasks.thisWeek'), tasks: [] },
    { key: 'later', label: t('tasks.later'), tasks: [] },
  ]
  for (const task of sortOpen(tasks)) {
    if (task.dueDate < today) groups[0].tasks.push(task)
    else if (task.dueDate === today) groups[1].tasks.push(task)
    else if (task.dueDate <= inWeek) groups[2].tasks.push(task)
    else groups[3].tasks.push(task)
  }
  return groups.filter((g) => g.tasks.length > 0)
}

export function TasksView({ activeFieldId, farmName, onNewTask, onEditTask, side }: {
  activeFieldId: string
  farmName: string
  onNewTask: () => void
  onEditTask: (task: Task) => void
  side: ReactNode
}) {
  const { t, locale } = useI18n()
  const { tasks: all, isLoading } = useTasks()
  const items = useAllItems()
  const [tab, setTab] = useState<'open' | 'done'>('open')

  const tasks = useMemo(() => tasksInScope(all, items, activeFieldId), [all, items, activeFieldId])
  const open = tasks.filter((task) => !task.done)
  const done = tasks.filter((task) => task.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  const today = todayISO()
  const inWeek = todayISO(new Date(Date.now() + 7 * 86400000))
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const counts = {
    overdue: open.filter((task) => task.dueDate < today).length,
    today: open.filter((task) => task.dueDate === today).length,
    week: open.filter((task) => task.dueDate > today && task.dueDate <= inWeek).length,
    doneWeek: done.filter((task) => (task.doneAt ?? '') >= weekAgo).length,
  }
  const groups = groupOpen(open, t)

  return (
    <div className="section-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow green-text">{farmName.toUpperCase()} · {t('tasks.title').toUpperCase()}</p>
          <h1>{t('tasks.title')}</h1>
          <p className="subtitle">{t('tasks.subtitle')}</p>
        </div>
        <button className="primary-button" onClick={onNewTask}><Plus data-icon="inline-start" />{t('task.new')}</button>
      </div>

      <div className="metrics-grid">
        {[
          { label: t('tasks.overdue'), value: counts.overdue, detail: t('tasks.metric.overdue'), icon: TriangleAlert, tone: 'rose' },
          { label: t('tasks.today'), value: counts.today, detail: t('tasks.metric.today'), icon: CalendarClock, tone: 'amber' },
          { label: t('tasks.thisWeek'), value: counts.week, detail: t('tasks.metric.week'), icon: CalendarDays, tone: 'blue' },
          { label: t('tasks.doneWeek'), value: counts.doneWeek, detail: t('tasks.metric.done'), icon: CircleCheck, tone: 'green' },
        ].map((m) => {
          const Icon = m.icon
          return (
            <div className="metric-card" key={m.label}>
              <div className={`metric-icon ${m.tone}`}><Icon aria-hidden="true" /></div>
              <div>
                <p className="eyebrow">{m.label}</p>
                <p className="metric-value">{fmt(m.value, locale)}</p>
                <p className="metric-detail">{m.detail}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-heading">
            <div><h2>{t('tasks.board')}</h2><p>{t('tasks.board.sub')}</p></div>
            <Segmented<'open' | 'done'>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'open', label: `${t('tasks.open')} · ${open.length}` },
                { value: 'done', label: `${t('tasks.done')} · ${done.length}` },
              ]}
            />
          </div>
          {isLoading ? (
            <div className="drawer-loading"><Loader2 className="spin" /></div>
          ) : tab === 'open' ? (
            groups.length === 0 ? (
              <div className="tasks-empty"><CircleCheck /><strong>{t('tasks.allClear')}</strong><span>{t('tasks.allClear.sub')}</span></div>
            ) : (
              groups.map((g) => (
                <div className={`task-group ${g.key}`} key={g.key}>
                  <h3>{g.label}<span>{g.tasks.length}</span></h3>
                  <TaskList tasks={g.tasks} onEdit={onEditTask} />
                </div>
              ))
            )
          ) : (
            <TaskList tasks={done.slice(0, 40)} onEdit={onEditTask} empty={<p className="detail-empty">{t('tasks.noneDone')}</p>} />
          )}
        </section>
        <aside className="right-column">{side}</aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bell & overview panel
// ---------------------------------------------------------------------------

export function BellMenu({ activeFieldId, onOpenTasks, onEditTask }: { activeFieldId: string; onOpenTasks: () => void; onEditTask: (task: Task) => void }) {
  const { t } = useI18n()
  const { tasks: all } = useTasks()
  const items = useAllItems()
  const [open, setOpen] = useState(false)
  const today = todayISO()
  const due = sortOpen(tasksInScope(all, items, activeFieldId).filter((task) => !task.done && task.dueDate <= today))
  const overdue = due.filter((task) => task.dueDate < today).length
  return (
    <div className="bell">
      <button className="icon-button bell-button" onClick={() => setOpen((o) => !o)} aria-label={t('bell.title')} aria-expanded={open}>
        <Bell />
        {due.length > 0 && <span className={overdue > 0 ? 'bell-badge urgent' : 'bell-badge'}>{due.length}</span>}
      </button>
      {open && (
        <>
          <div className="lang-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-menu" role="dialog" aria-label={t('bell.title')}>
            <div className="bell-head">
              <strong>{t('bell.title')}</strong>
              {due.length > 0 && <span>{overdue > 0 ? t('bell.overdue', { n: overdue }) : t('bell.today', { n: due.length })}</span>}
            </div>
            <TaskList
              tasks={due.slice(0, 6)}
              compact
              onEdit={(task) => { setOpen(false); onEditTask(task) }}
              empty={<div className="bell-empty"><CircleCheck />{t('bell.empty')}</div>}
            />
            <button className="bell-foot" onClick={() => { setOpen(false); onOpenTasks() }}>{t('tasks.viewAll')}</button>
          </div>
        </>
      )}
    </div>
  )
}

export function UpcomingTasksPanel({ activeFieldId, onOpenTasks, onEditTask, onNewTask }: {
  activeFieldId: string
  onOpenTasks: () => void
  onEditTask: (task: Task) => void
  onNewTask: () => void
}) {
  const { t } = useI18n()
  const { tasks: all } = useTasks()
  const items = useAllItems()
  const upcoming = sortOpen(tasksInScope(all, items, activeFieldId).filter((task) => !task.done)).slice(0, 5)
  return (
    <section className="panel tasks-panel">
      <div className="panel-heading">
        <div><h2>{t('tasks.panel')}</h2><p>{t('tasks.panel.sub')}</p></div>
        <button className="text-button" onClick={onOpenTasks}>{t('tasks.viewAll')}</button>
      </div>
      <TaskList
        tasks={upcoming}
        compact
        onEdit={onEditTask}
        empty={<p className="detail-empty" style={{ marginTop: 16 }}>{t('tasks.allClear')}</p>}
      />
      <button className="ghost-button full" onClick={onNewTask}><Plus />{t('task.new')}</button>
    </section>
  )
}
