import { describe, it, expect, vi } from 'vitest';
import type { Template, PipelineState, PipelineMode } from '../src/types.js';
import { SkillRunner, type SkillRunnerConfig } from '../src/runtime/skill-runner.js';

vi.mock('../src/types.js', async () => {
  const actual = await vi.importActual('../src/types.js') as any;
  return { ...actual, callSubagent: vi.fn().mockRejectedValue(new Error('mock subagent failed')) };
});

const mockTemplate: Template = {
  name: 'test', description: 'test',
  stages: [{ id: 's1', agent: 'agent-a', checkpoint: true, allow_read: ['*'], allow_write: ['out'] }],
  slots: { out: { type: 'text', default: '' } },
};

const mockState: PipelineState = {
  template_name: 'test', current_stage: 0,
  slot_values: {}, slot_history: {}, remarks: [], stage_history: [],
  status: 'running', mode: 'relay' as PipelineMode,
};

describe('SkillRunner', () => {
  describe('buildToolList', () => {
    it('合并 agentTools 和 additionalTools，去重优先', () => {
      const agentTools = [
        { id: 't1', name: 'tool1' },
        { id: 't2', name: 'tool2' },
      ];
      const additionalTools = [
        { id: 't2', name: 'tool2-override' },
        { id: 't3', name: 'tool3' },
      ];
      const result = SkillRunner.buildToolList(agentTools, additionalTools);
      expect(result).toHaveLength(3);
      const t2 = result.find(t => t.id === 't2');
      expect(t2!.name).toBe('tool2-override');
    });

    it('空列表返回空数组', () => {
      expect(SkillRunner.buildToolList([])).toEqual([]);
    });

    it('无 additionalTools 时只返回 agentTools', () => {
      const result = SkillRunner.buildToolList([{ id: 't1', name: 'tool1' }]);
      expect(result).toHaveLength(1);
    });
  });

  describe('run', () => {
    it('callSubagent 失败返回错误结果', async () => {
      const config: SkillRunnerConfig = {
        agentName: 'test-agent',
        userId: 'u1',
        projectId: 'p1',
        template: mockTemplate,
        state: mockState,
        prompt: 'hello',
      };
      const result = await SkillRunner.run(config);
      expect(result.success).toBe(false);
      expect(result.output).toContain('执行出错');
    });

    it('getAgentTools 返回空数组', async () => {
      const tools = await SkillRunner.getAgentTools('test');
      expect(tools).toEqual([]);
    });
  });
});
