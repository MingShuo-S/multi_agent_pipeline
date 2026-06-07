import { describe, it, expect } from 'vitest';
import { ToolAuth } from '../src/tools/tool-auth.js';
import type { Template } from '../src/types.js';

const mockTemplate: Template = {
  name: 'test',
  description: 'test template',
  stages: [
    {
      id: 'stage1',
      agent: 'agent-a',
      checkpoint: true,
      allow_read: ['slot1'],
      allow_write: ['slot2'],
    },
    {
      id: 'stage2',
      agent: 'agent-b',
      checkpoint: false,
      allow_read: ['*'],
      allow_write: ['slot3'],
    },
  ],
  slots: {
    slot1: { type: 'text', default: '' },
    slot2: { type: 'text', default: '' },
    slot3: { type: 'text', default: '' },
  },
};

describe('ToolAuth', () => {
  describe('checkSlotAccess', () => {
    it('允许当前阶段读自己的 slot', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot1', 'read', mockTemplate, 0)).not.toThrow();
    });

    it('允许当前阶段写自己的 slot', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot2', 'write', mockTemplate, 0)).not.toThrow();
    });

    it('拒绝读其他 stage 的 slot', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot3', 'read', mockTemplate, 0)).toThrow('not allowed');
    });

    it('拒绝写其他 stage 的 slot', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot1', 'write', mockTemplate, 0)).toThrow('not allowed');
    });

    it('通配符 * 允许读任何 slot', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-b', 'slot1', 'read', mockTemplate, 1)).not.toThrow();
    });

    it('非法 stage index 抛错', () => {
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot1', 'read', mockTemplate, -1)).toThrow('Invalid stage index');
      expect(() => ToolAuth.checkSlotAccess('agent-a', 'slot1', 'read', mockTemplate, 99)).toThrow('Invalid stage index');
    });
  });

  describe('getReadableSlots', () => {
    it('返回当前 stage 的 allow_read 列表', () => {
      const slots = ToolAuth.getReadableSlots(mockTemplate, 0);
      expect(slots).toEqual(['slot1']);
    });

    it('通配符返回全部 slot', () => {
      const slots = ToolAuth.getReadableSlots(mockTemplate, 1);
      expect(slots).toEqual(['slot1', 'slot2', 'slot3']);
    });

    it('非法 index 返回空数组', () => {
      expect(ToolAuth.getReadableSlots(mockTemplate, -1)).toEqual([]);
    });
  });

  describe('getWritableSlots', () => {
    it('返回当前 stage 的 allow_write 列表', () => {
      const slots = ToolAuth.getWritableSlots(mockTemplate, 0);
      expect(slots).toEqual(['slot2']);
    });

    it('非法 index 返回空数组', () => {
      expect(ToolAuth.getWritableSlots(mockTemplate, -1)).toEqual([]);
    });
  });
});
