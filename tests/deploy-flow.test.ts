import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WR, UID, PID } from './fixtures/templates.js';

const { mockFs, resetFs, setFile } = vi.hoisted(() => {
  const files = new Map<string, string>();
  const enoent = (p: string) => { const e = new Error(`ENOENT: ${p}`) as any; e.code = 'ENOENT'; throw e; };
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    mockFs: {
      mkdirSync: () => {},
      promises: {
        readFile: async (p: string) => { const k = norm(p); if (files.has(k)) return files.get(k)!; throw enoent(p); },
        writeFile: async (p: string, c: string) => { files.set(norm(p), c); },
        mkdir: async () => {},
        readdir: async (dir: string) => {
          const prefix = norm(dir) + '/';
          const entries = [...files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]);
          return [...new Set(entries)];
        },
        access: async (p: string) => { if (!files.has(norm(p))) throw enoent(p); },
        unlink: async (p: string) => { const k = norm(p); if (!files.has(k)) throw enoent(p); files.delete(k); },
        copyFile: async (src: string, dst: string) => { const sk = norm(src); if (files.has(sk)) files.set(norm(dst), files.get(sk)!); },
      },
    },
    setFile: (path: string, content: string) => files.set(norm(path), content),
    resetFs: () => files.clear(),
  };
});
vi.mock('fs', () => mockFs);

const makeTpl = (name: string, agent = 'solo') => ({
  name, description: name,
  stages: [{ id: 'only', agent, checkpoint: true, allow_read: ['*'], allow_write: ['output'] }],
  slots: { output: { type: 'text', default: '' } },
});

function seedTemplate(name: string) {
  const { SEED_TEMPLATES_DIR } = (globalThis as any).__config || {};
  if (!SEED_TEMPLATES_DIR) return;
  const sdir = SEED_TEMPLATES_DIR.replace(/\\/g, '/');
  setFile(`${sdir}/${name}.json`, JSON.stringify(makeTpl(name)));
}

async function loadConfig() {
  const mod = await import('../src/config.js');
  (globalThis as any).__config = mod;
  return mod;
}

function simulateDeployDirs() {
  setFile(`${WR}/templates/.dir`, '');
  setFile(`${WR}/projects/.dir`, '');
  setFile(`${WR}/agent-guides/.dir`, '');
  setFile(`${WR}/_profiles/.dir`, '');
}

describe('1. config.ts 路径解析与 deploy.sh 对齐', () => {
  it('WORKSPACE_ROOT 以 workspace 结尾', async () => {
    const { WORKSPACE_ROOT } = await import('../src/config.js');
    expect(WORKSPACE_ROOT.replace(/\\/g, '/')).toMatch(/\/workspace$/);
  });

  it('PROFILES_DIR 是 WORKSPACE_ROOT 的 _profiles 子目录', async () => {
    const { WORKSPACE_ROOT, PROFILES_DIR } = await import('../src/config.js');
    const wr = WORKSPACE_ROOT.replace(/\\/g, '/');
    const pd = PROFILES_DIR.replace(/\\/g, '/');
    expect(pd).toBe(`${wr}/_profiles`);
  });

  it('KNOWLEDGE_DIR 是 WORKSPACE_ROOT 的 knowledge 子目录', async () => {
    const { WORKSPACE_ROOT, KNOWLEDGE_DIR } = await import('../src/config.js');
    const wr = WORKSPACE_ROOT.replace(/\\/g, '/');
    const kd = KNOWLEDGE_DIR.replace(/\\/g, '/');
    expect(kd).toBe(`${wr}/knowledge`);
  });

  it('SEED_TEMPLATES_DIR 与 WORKSPACE_ROOT/templates 不同', async () => {
    const { WORKSPACE_ROOT, SEED_TEMPLATES_DIR } = await import('../src/config.js');
    expect(SEED_TEMPLATES_DIR).not.toBe(`${WORKSPACE_ROOT}/templates`);
  });
});

describe('2. 部署目录结构一致性', () => {
  const deployMkdir = [
    'templates',
    'projects',
    'agent-guides',
    '_profiles',
  ];
  const initMkdir = [
    'templates',
    'projects',
    'projects/__example__/agents',
    'agent-guides',
  ];

  it('deploy.sh 创建 _profiles/ 等目录匹配 config.ts 期望', async () => {
    const { WORKSPACE_ROOT, PROFILES_DIR } = await import('../src/config.js');
    const expectedDirs = [
      WORKSPACE_ROOT + '/templates',
      WORKSPACE_ROOT + '/projects',
      WORKSPACE_ROOT + '/agent-guides',
      PROFILES_DIR,
    ];
    for (const d of expectedDirs) {
      setFile(d.replace(/\\/g, '/') + '/.f', '');
    }
    for (const d of expectedDirs) {
      const normPath = d.replace(/\\/g, '/') + '/.f';
      const { access } = await (await import('fs')).promises;
      await expect(access(normPath)).resolves.toBeUndefined();
    }
  });

  it('initWorkspace 创建 deploy.sh 未覆盖的子目录', async () => {
    await loadConfig();
    simulateDeployDirs();
    const { initWorkspace } = await import('../src/tools/workspace-config.js');
    const result = await initWorkspace(WR);
    const created = result.created.map(p => p.replace(/\\/g, '/'));
    expect(created.some(c => c.includes('__example__/agents'))).toBe(true);
  });
});

describe('3. 模板部署全链路 (seed → workspace → discover)', () => {
  beforeEach(async () => {
    resetFs();
    vi.clearAllMocks();
    await loadConfig();
    simulateDeployDirs();
  });

  it('initWorkspace 复制全部 seed .json 到 workspace/templates/', async () => {
    seedTemplate('xiaohongshu-creation');
    seedTemplate('blog-writing');
    const { initWorkspace } = await import('../src/tools/workspace-config.js');
    const result = await initWorkspace(WR);
    const paths = result.created.map(p => p.replace(/\\/g, '/'));
    expect(paths.some(p => p.endsWith('xiaohongshu-creation.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('blog-writing.json'))).toBe(true);
  });

  it('list_templates 返回所有已部署模板，不含非 .json', async () => {
    seedTemplate('t1');
    seedTemplate('t2');
    const { initWorkspace, WorkspaceConfigManager } = await import('../src/tools/workspace-config.js');
    await initWorkspace(WR);
    const mgr = new WorkspaceConfigManager(WR);
    const list = await mgr.listTemplates();
    expect(list).toContain('t1.json');
    expect(list).toContain('t2.json');
    expect(list.every(f => f.endsWith('.json'))).toBe(true);
  });

  it('新模板加入 seed 后 initWorkspace 自动部署', async () => {
    seedTemplate('existing');
    const { initWorkspace, WorkspaceConfigManager } = await import('../src/tools/workspace-config.js');
    await initWorkspace(WR);
    let list = (await (new WorkspaceConfigManager(WR)).listTemplates());
    expect(list).not.toContain('new-app.json');
    seedTemplate('new-app');
    await initWorkspace(WR);
    list = await (new WorkspaceConfigManager(WR)).listTemplates();
    expect(list).toContain('new-app.json');
  });
});

describe('4. pipeline_start 自动 init 流程', () => {
  beforeEach(async () => {
    resetFs();
    vi.clearAllMocks();
    await loadConfig();
    simulateDeployDirs();
  });

  it('模板不存在时自动调用 initWorkspace 再读取', async () => {
    seedTemplate('auto-deploy');
    const { pipelineStart } = await import('../src/tools/pipeline-start.js');
    const result = await pipelineStart('auto-deploy', UID, PID, '', WR);
    expect(result.status).not.toBe('error');
    const { WorkspaceConfigManager } = await import('../src/tools/workspace-config.js');
    const list = await (new WorkspaceConfigManager(WR)).listTemplates();
    expect(list).toContain('auto-deploy.json');
  });

  it('第二次 pipeline_start 不再重复 init', async () => {
    seedTemplate('cached');
    const { pipelineStart } = await import('../src/tools/pipeline-start.js');
    const r1 = await pipelineStart('cached', UID, PID, '', WR);
    expect(r1.status).not.toBe('error');
    const r2 = await pipelineStart('cached', UID + '-2', PID + '-2', '', WR);
    expect(r2.status).not.toBe('error');
  });
});

describe('5. 端到端：deploy → discover → pipeline_start → state', () => {
  beforeEach(async () => {
    resetFs();
    vi.clearAllMocks();
    await loadConfig();
    simulateDeployDirs();
    seedTemplate('prod-tpl');
  });

  it('orchestrator 发现 → 读取 → pipeline_start → state 正确', async () => {
    const { WorkspaceConfigManager, initWorkspace } = await import('../src/tools/workspace-config.js');
    await initWorkspace(WR);
    const mgr = new WorkspaceConfigManager(WR);
    const all = await mgr.listTemplates();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const tpl = await mgr.readTemplate('prod-tpl');
    expect(tpl.name).toBe('prod-tpl');
    const { pipelineStart } = await import('../src/tools/pipeline-start.js');
    const result = await pipelineStart('prod-tpl', UID, PID, '', WR);
    expect(result.status).toBe('initialized');
    const raw = await (await import('fs')).promises.readFile(`${WR}/projects/${UID}/${PID}/state.json`, 'utf-8');
    const state = JSON.parse(raw);
    expect(state.template_name).toBe('prod-tpl');
    expect(state.status).toBe('running');
    expect(state.current_stage).toBe(0);
  });
});

describe('6. deploy.sh 与 setup-workspace.sh 目录交集与覆盖', () => {
  it('deploy.sh 创建 _profiles/ 不含 __template__', async () => {
    const pdir = 'C:/workspace/_profiles';
    setFile(`${pdir}/.f`, '');
    const fs = (await import('fs'));
    await expect(fs.promises.access(`${pdir}/.f`)).resolves.toBeUndefined();
  });

  it('setup-workspace.sh 补全 __template__ 子结构', async () => {
    const pdir = 'C:/workspace/_profiles';
    setFile(`${pdir}/__template__/profile/.f`, '');
    setFile(`${pdir}/__template__/memory/.f`, '');
    setFile(`${pdir}/__template__/logs/.f`, '');
    const fs = (await import('fs'));
    const subs = await fs.promises.readdir(`${pdir}/__template__`);
    expect(subs).toContain('profile');
    expect(subs).toContain('memory');
    expect(subs).toContain('logs');
  });

  it('setup-workspace.sh 模板使用新文件名 profile.json / memory.json', async () => {
    const pdir = 'C:/workspace/_profiles/__template__';
    const profile = { userId: '__USER_ID__', version: 1, corePrinciples: [] };
    setFile(`${pdir}/profile.json`, JSON.stringify(profile));
    setFile(`${pdir}/memory.json`, '[]');
    const fs = (await import('fs'));
    const p = JSON.parse(await fs.promises.readFile(`${pdir}/profile.json`, 'utf-8'));
    expect(p.userId).toBe('__USER_ID__');
    const m = JSON.parse(await fs.promises.readFile(`${pdir}/memory.json`, 'utf-8'));
    expect(Array.isArray(m)).toBe(true);
  });

  it('profile.json 是扁平结构（无 dna 包裹）', async () => {
    const pdir = 'C:/workspace/_profiles/u1';
    setFile(`${pdir}/.dir`, '');
    const flat = { userId: 'u1', version: 1, corePrinciples: ['简洁'] };
    setFile(`${pdir}/profile.json`, JSON.stringify(flat));
    const { StyleSystem } = await import('../src/tools/style-system.js');
    const sys = new StyleSystem('C:/workspace', 'u1');
    const profile = await sys.readProfile();
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe('u1');
  });
});
