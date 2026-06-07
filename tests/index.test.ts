import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('index.ts — 模块结构', () => {
  it('导出插件定义', async () => {
    const mod = await import('../src/index.js');
    const defaultExport = mod.default;
    expect(defaultExport).toBeDefined();
    expect(defaultExport.id).toBe('multi-agent-pipeline');
    expect(defaultExport.name).toContain('部虾创');
    expect(typeof defaultExport.register).toBe('function');
  });

  it('重新导出所有关键类', async () => {
    const mod = await import('../src/index.js');
    const classes = ['PipelineRunner', 'StateManager', 'PromptBuilder', 'SkillRunner',
      'ToolAuth', 'MemoryManager', 'WorkspaceConfigManager', 'AgentGuideGenerator',
      'StyleSystem', 'InjectionLayer'];
    for (const cls of classes) {
      expect(mod[cls]).toBeDefined();
    }
  });

  it('重新导出类型', async () => {
    const mod = await import('../src/index.js');
    // 类型只在 TS 编译时存在，但期望导出中存在（编译后移除）
    // 至少确保模块无语法错误
    expect(mod).toBeDefined();
  });
});
