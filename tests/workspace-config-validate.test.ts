import { describe, it, expect } from 'vitest';
import { validateTemplate } from '../src/tools/workspace-config.js';

describe('validateTemplate', () => {
  it('合法模板返回空错误数组', () => {
    const valid = {
      name: 'test',
      description: 'test template',
      stages: [
        { id: 's1', agent: 'agent-a', checkpoint: true, allow_read: ['a'], allow_write: ['b'] },
      ],
      slots: {
        a: { type: 'text', default: '' },
      },
    };
    expect(validateTemplate(valid)).toEqual([]);
  });

  it('null/undefined 报错', () => {
    expect(validateTemplate(null)).toEqual(['模板必须是对象']);
    expect(validateTemplate(undefined)).toEqual(['模板必须是对象']);
  });

  it('缺少 name 报错', () => {
    const noName = { description: 'x', stages: [], slots: {} };
    const errs = validateTemplate(noName);
    expect(errs).toContain('缺少 name (string)');
  });

  it('缺少 description 报错', () => {
    const noDesc = { name: 'x', stages: [], slots: {} };
    const errs = validateTemplate(noDesc);
    expect(errs).toContain('缺少 description (string)');
  });

  it('stages 为空数组报错', () => {
    const emptyStages = { name: 'x', description: 'x', stages: [], slots: {} };
    const errs = validateTemplate(emptyStages);
    expect(errs).toContain('stages 不能为空');
  });

  it('校验每个 stage 的必填字段', () => {
    const badStage = {
      name: 'x', description: 'x',
      stages: [{ checkpoint: true, allow_read: [], allow_write: [] }],
      slots: { a: { type: 'text', default: '' } },
    };
    const errs = validateTemplate(badStage);
    expect(errs.some(e => e.includes('stages[0] 缺少 id'))).toBe(true);
    expect(errs.some(e => e.includes('stages[0] 缺少 agent'))).toBe(true);
  });

  it('校验 slot 的 type 字段', () => {
    const badSlot = {
      name: 'x', description: 'x',
      stages: [{ id: 's1', agent: 'a', checkpoint: true, allow_read: [], allow_write: [] }],
      slots: { a: { type: 'invalid', default: '' } },
    };
    const errs = validateTemplate(badSlot);
    expect(errs.some(e => e.includes('slots.a 缺少有效的 type'))).toBe(true);
  });

  it('校验 slot 缺少 default', () => {
    const noDefault = {
      name: 'x', description: 'x',
      stages: [{ id: 's1', agent: 'a', checkpoint: true, allow_read: [], allow_write: [] }],
      slots: { a: { type: 'text' } },
    };
    const errs = validateTemplate(noDefault);
    expect(errs.some(e => e.includes('slots.a 缺少 default'))).toBe(true);
  });

  it('stage 的 checkpoint 非 boolean 报错', () => {
    const badCheckpoint = {
      name: 'x', description: 'x',
      stages: [{ id: 's1', agent: 'a', checkpoint: 'yes', allow_read: [], allow_write: [] }],
      slots: { a: { type: 'text', default: '' } },
    };
    const errs = validateTemplate(badCheckpoint);
    expect(errs.some(e => e.includes('stages[0] 缺少 checkpoint'))).toBe(true);
  });
});
