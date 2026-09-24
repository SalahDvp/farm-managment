'use client'

// Shared SWR hooks so every component reads the same cached lists, plus a
// single `refresh` that revalidates everything after a mutation.

import { useCallback } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import type { Field, Item, Task } from '@/lib/farm-types'
import { fetcher } from '@/lib/ui'

const NO_ITEMS: Item[] = []
const NO_FIELDS: Field[] = []
const NO_TASKS: Task[] = []

/** Every item on the farm, regardless of the active field. */
export function useAllItems(): Item[] {
  const { data } = useSWR<{ items: Item[] }>('/api/farm-items', fetcher)
  return data?.items ?? NO_ITEMS
}

export function useFields(): { fields: Field[]; backend?: string } {
  const { data } = useSWR<{ fields: Field[]; backend: string }>('/api/fields', fetcher)
  return { fields: data?.fields ?? NO_FIELDS, backend: data?.backend }
}

export function useTasks(): { tasks: Task[]; isLoading: boolean } {
  const { data, isLoading } = useSWR<{ tasks: Task[] }>('/api/tasks', fetcher)
  return { tasks: data?.tasks ?? NO_TASKS, isLoading }
}

/** Revalidate every API-backed list and record after a change. */
export function useRefresh(): () => void {
  const { mutate } = useSWRConfig()
  return useCallback(() => {
    void mutate((key) => typeof key === 'string' && key.startsWith('/api/'))
  }, [mutate])
}
