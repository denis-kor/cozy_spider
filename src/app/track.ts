/**
 * Счётчик событий интереса.
 *
 * Fake-door тест без аналитики бессмысленен: вся его ценность — число
 * нажатий «Купить». Пока сайт статический и бэкенда нет, событие уходит
 * в Яндекс.Метрику (стандарт для РФ-трафика, работает без своего сервера),
 * а копия всегда падает в localStorage — чтобы посмотреть цифры даже до
 * того, как счётчик заведён.
 *
 * Подключение Метрики: зарегистрировать счётчик, вставить её сниппет в
 * index.html и вписать номер сюда. Больше ничего не трогать — цели
 * (`reachGoal`) создаются в интерфейсе Метрики по именам событий.
 */
const METRIKA_ID = 112115281

declare global {
  interface Window {
    ym?: (id: number, method: 'reachGoal', goal: string, params?: Record<string, unknown>) => void
  }
}

const STORE_KEY = 'cozy.metrics'

export function track(event: string, params?: Record<string, unknown>): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, number>
    const detail = params?.sku ?? params?.provider
    const key = detail ? `${event}:${String(detail)}` : event
    all[key] = (all[key] ?? 0) + 1
    localStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch {
    // Приватный режим без localStorage — не повод ронять игру ради метрики.
  }

  if (METRIKA_ID && window.ym) window.ym(METRIKA_ID, 'reachGoal', event, params)
  if (import.meta.env.DEV) console.debug('[track]', event, params ?? '')
}

/** Посмотреть локальные цифры из консоли: `__metrics()` в дев-режиме. */
export function readLocalMetrics(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
