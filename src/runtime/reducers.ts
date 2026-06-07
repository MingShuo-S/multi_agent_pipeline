// src/runtime/reducers.ts - Slot 级别合并策略

import type { Reducer } from '../types.js';

/**
 * 按 reducer 策略合并 current 和 update
 * - replace: 后写覆盖前写（默认行为）
 * - append: 追加到数组末尾
 * - merge: 浅合并对象
 */
export function applyReducer(current: unknown, update: unknown, reducer: Reducer = 'replace'): unknown {
  switch (reducer) {
    case 'replace':
      return update;

    case 'append':
      if (current === undefined || current === null || current === '') {
        return Array.isArray(update) ? update : [update];
      }
      if (!Array.isArray(current)) {
        return [current, update];
      }
      return [...current, update];

    case 'merge':
      if (typeof current !== 'object' || current === null) return update;
      if (typeof update !== 'object' || update === null) return update;
      return { ...(current as Record<string, unknown>), ...(update as Record<string, unknown>) };
  }
}
