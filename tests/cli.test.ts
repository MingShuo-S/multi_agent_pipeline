import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { initMock, runMock, lastRunnerArgs } = vi.hoisted(() => {
  const runMock = vi.fn().mockResolvedValue(undefined);
  const lastRunnerArgs: any[] = [];
  return {
    initMock: vi.fn(),
    runMock,
    lastRunnerArgs,
  };
});

vi.mock('../src/install.js', () => ({ initializeWorkspace: initMock }));
vi.mock('../src/runtime/pipeline-runner.js', () => ({
  PipelineRunner: vi.fn().mockImplementation(function (this: any, ...args: any[]) {
    lastRunnerArgs.length = 0;
    lastRunnerArgs.push(...args);
    this.run = runMock;
  }),
}));

describe('cli.ts', () => {
  const originalExit = process.exit;
  const originalArgv = process.argv;

  beforeEach(() => {
    process.exit = vi.fn() as any;
    initMock.mockClear();
    runMock.mockClear();
    lastRunnerArgs.length = 0;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.argv = originalArgv;
  });

  it('init 命令调用 initializeWorkspace', async () => {
    process.argv = ['node', 'cli.js', 'init'];
    const mod = await import('../src/cli.js');
    await mod.main();
    expect(initMock).toHaveBeenCalled();
  });

  it('start 命令创建 PipelineRunner 传正确的 template', async () => {
    process.argv = ['node', 'cli.js', 'start', 'my-template', '--user', 'u1', '--project', 'p1'];
    const mod = await import('../src/cli.js');
    await mod.main();
    expect(lastRunnerArgs[3]).toBe('my-template');
  });

  it('start 命令调用 runner.run', async () => {
    process.argv = ['node', 'cli.js', 'start', 't1', '--user', 'u', '--project', 'p'];
    const mod = await import('../src/cli.js');
    await mod.main();
    expect(runMock).toHaveBeenCalled();
  });

  it('模块可安全导入（不自动执行 yargs）', async () => {
    process.argv = ['node', 'some_test_runner.js'];
    const mod = await import('../src/cli.js');
    expect(typeof mod.main).toBe('function');
    expect(process.exit).not.toHaveBeenCalled();
  });
});
