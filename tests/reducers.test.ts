import { describe, it, expect } from 'vitest';
import { applyReducer } from '../src/runtime/reducers.js';

describe('applyReducer', () => {
  describe('replace', () => {
    it('后写覆盖前写', () => {
      expect(applyReducer('old', 'new', 'replace')).toBe('new');
    });

    it('空值替换', () => {
      expect(applyReducer('', 'new', 'replace')).toBe('new');
    });

    it('对象替换', () => {
      expect(applyReducer({ a: 1 }, { b: 2 }, 'replace')).toEqual({ b: 2 });
    });
  });

  describe('append', () => {
    it('追加到数组末尾', () => {
      expect(applyReducer(['a', 'b'], 'c', 'append')).toEqual(['a', 'b', 'c']);
    });

    it('空值时创建数组', () => {
      expect(applyReducer('', 'item', 'append')).toEqual(['item']);
    });

    it('非数组时包装为数组', () => {
      expect(applyReducer('existing', 'new', 'append')).toEqual(['existing', 'new']);
    });

    it('追加数组到数组', () => {
      expect(applyReducer(['a'], ['b', 'c'], 'append')).toEqual(['a', ['b', 'c']]);
    });

    it('不乱序', () => {
      const result = applyReducer(['first'], 'second', 'append');
      expect(result).toEqual(['first', 'second']);
      expect((result as string[])[0]).toBe('first');
      expect((result as string[])[1]).toBe('second');
    });
  });

  describe('merge', () => {
    it('浅合并对象', () => {
      expect(applyReducer({ a: 1, b: 2 }, { b: 3, c: 4 }, 'merge')).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('current 非对象时返回 update', () => {
      expect(applyReducer('not-object', { a: 1 }, 'merge')).toEqual({ a: 1 });
    });

    it('update 非对象时返回 update', () => {
      expect(applyReducer({ a: 1 }, 'not-object', 'merge')).toBe('not-object');
    });

    it('null current 返回 update', () => {
      expect(applyReducer(null, { a: 1 }, 'merge')).toEqual({ a: 1 });
    });

    it('null update 返回 update', () => {
      expect(applyReducer({ a: 1 }, null, 'merge')).toBeNull();
    });
  });

  describe('默认 reducer', () => {
    it('未指定时默认 replace', () => {
      expect(applyReducer('old', 'new')).toBe('new');
    });
  });
});
