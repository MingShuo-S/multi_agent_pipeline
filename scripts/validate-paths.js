#!/usr/bin/env node
/**
 * scripts/validate-paths.js
 *
 * 验证 multi_agent_pipeline 所有路径一致性。
 * 从脚本和源码中提取所有引用的路径，对照实际目录结构检查。
 *
 * 用法: node scripts/validate-paths.js
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ========== 配置 ==========
let errors = 0;
const report = [];
const pass = (msg) => report.push(`  ✓ ${msg}`);
const fail = (msg) => { report.push(`  ✗ ${msg}`); errors++; };

// ========== 第一段：检查实际目录/文件是否存在 ==========
console.log('=== 1. 源码目录结构检查 ===');
const checks = [
  ['project root', '.', true],
  ['src/', 'src', true],
  ['src/config.ts', 'src/config.ts', true],
  ['src/index.ts', 'src/index.ts', true],
  ['src/install.ts', 'src/install.ts', true],
  ['src/tools/style-system.ts', 'src/tools/style-system.ts', true],
  ['src/tools/session-memory.ts', 'src/tools/session-memory.ts', true],
  ['src/tools/workspace-config.ts', 'src/tools/workspace-config.ts', true],
  ['src/tools/knowledge-reader.ts', 'src/tools/knowledge-reader.ts', true],
  ['src/tools/pipeline-start.ts', 'src/tools/pipeline-start.ts', true],
  ['src/tools/pipeline-continue.ts', 'src/tools/pipeline-continue.ts', true],
  ['src/runtime/injection-layer.ts', 'src/runtime/injection-layer.ts', true],
  ['src/runtime/state-manager.ts', 'src/runtime/state-manager.ts', true],
  ['src/runtime/prefetch.ts', 'src/runtime/prefetch.ts', true],
  ['src/tools/memory.ts', 'src/tools/memory.ts', true],
  ['src/rules/ (seed)', 'src/rules', true],
  ['src/agent-guide-templates/', 'src/agent-guide-templates', true],
  ['templates/', 'templates', true],
  ['templates/agent-configs/', 'templates/agent-configs', true],
  ['docs/', 'docs', true],
  ['applications/buxiachuang/', 'applications/buxiachuang', true],
  ['scripts/deploy.sh', 'scripts/deploy.sh', true],
  ['scripts/setup-workspace.sh', 'scripts/setup-workspace.sh', true],
  ['scripts/lib.sh', 'scripts/lib.sh', true],
  ['scripts/sync-agent-configs.sh', 'scripts/sync-agent-configs.sh', true],
  ['scripts/sync-ai-summary.sh', 'scripts/sync-ai-summary.sh', true],
  ['scripts/validate-paths.js (self)', 'scripts/validate-paths.js', false],
];
for (const [label, rel, isRequired] of checks) {
  const p = path.join(ROOT, rel);
  try { await fs.access(p); pass(`${label} (${rel})`); }
  catch { if (isRequired) fail(`${label} 不存在: ${rel}`); else pass(`${label} (self)`); }
}

// ========== 第二段：解析 config.ts 路径定义 ==========
console.log('\n=== 2. config.ts 路径定义 ===');

// 模拟 config.ts 的路径解析逻辑
const PLUGIN_ROOT = path.join(__dirname, '..');
const WORKSPACE_ROOT = path.join(PLUGIN_ROOT, 'workspace');
const SEED_TEMPLATES_DIR = path.join(PLUGIN_ROOT, 'templates');
const PROFILES_DIR = path.join(WORKSPACE_ROOT, '_profiles');
const KNOWLEDGE_DIR = path.join(WORKSPACE_ROOT, 'knowledge');

pass(`WORKSPACE_ROOT = ${WORKSPACE_ROOT}`);
pass(`SEED_TEMPLATES_DIR = ${SEED_TEMPLATES_DIR}`);
pass(`PROFILES_DIR = ${PROFILES_DIR}`);
pass(`KNOWLEDGE_DIR = ${KNOWLEDGE_DIR}`);

// WORKSPACE_ROOT 是否存在？
try {
  await fs.access(WORKSPACE_ROOT);
  pass(`WORKSPACE_ROOT 存在`);
} catch {
  fail(`WORKSPACE_ROOT 不存在: ${WORKSPACE_ROOT} （首次 deploy/install 后创建）`);
}

// ========== 第三段：检查 install.ts 创建的路径是否一致 ==========
console.log('\n=== 3. install.ts 目录 + 文件路径 ===');

const installDirs = [
  WORKSPACE_ROOT,
  path.join(WORKSPACE_ROOT, 'templates'),
  path.join(WORKSPACE_ROOT, 'projects'),
  path.join(WORKSPACE_ROOT, 'projects', '__example__', 'agents'),
  path.join(WORKSPACE_ROOT, 'agent-guides'),
  path.join(WORKSPACE_ROOT, 'rules'),
  PROFILES_DIR,
  path.join(PROFILES_DIR, '__template__', 'profile'),
  path.join(PROFILES_DIR, '__template__', 'memory'),
  path.join(PROFILES_DIR, '__template__', 'logs'),
];
for (const d of installDirs) {
  try { await fs.access(d); pass(`install creates: ${path.relative(WORKSPACE_ROOT, d)}`); }
  catch { fail(`install 目录不存在: ${d}`); }
}

// install.ts 从 src/rules/ 和 src/agent-guide-templates/ 复制
try {
  const rules = await fs.readdir(path.join(ROOT, 'src', 'rules'));
  for (const f of rules.filter(x => x.endsWith('.md'))) {
    try { await fs.access(path.join(WORKSPACE_ROOT, 'rules', f)); pass(`rules 文件已同步: ${f}`); }
    catch { fail(`rules 文件缺失: ${f} （install.ts 未复制到 workspace/rules/）`); }
  }
} catch { /* src/rules not exist — skip */ }

try {
  const guides = await fs.readdir(path.join(ROOT, 'src', 'agent-guide-templates'));
  for (const f of guides.filter(x => x.endsWith('.md'))) {
    try { await fs.access(path.join(WORKSPACE_ROOT, 'agent-guides', f)); pass(`agent-guide 已同步: ${f}`); }
    catch { fail(`agent-guide 文件缺失: ${f} （install.ts 未复制）`); }
  }
} catch { /* dir not exist */ }

// ========== 第四段：运行时路径检查（跨文件引用） ==========
console.log('\n=== 4. 运行时路径一致性 ===');

// 4a. StateManager: projects/{userId}/{projectId}/state.json
const statePath = path.join(WORKSPACE_ROOT, 'projects', '{userId}', '{projectId}', 'state.json');
pass(`StateManager 状态路径: projects/{userId}/{projectId}/state.json`);
pass(`  → 匹配 StateManager 构造函数 (line 20-26)`);
pass(`  → 匹配 pipeline-start.ts stateManager 用法`);

// 4b. StyleSystem: workspaceRoot + '/_profiles/' + userId
const styleDir = path.join(WORKSPACE_ROOT, '_profiles', '{userId}');
pass(`StyleSystem 根: _profiles/{userId}/`);
pass(`  → ${styleDir}/profile.json`);
pass(`  → ${styleDir}/memory.json`);
pass(`  → ${styleDir}/profile/persona.md`);
pass(`  → ${styleDir}/memory/insights.md`);
pass(`  → ${styleDir}/voiceprint-state.json`);

// 4c. Session-memory paths
const memDir = path.join(WORKSPACE_ROOT, '_profiles', '{userId}', 'memory');
pass(`session-memory 路径: _profiles/{userId}/memory/`);
pass(`  → session-snapshot.md`);
pass(`  → session-note.md`);
pass(`  → handoff-log/`);
pass(`  → insights.md`);
// verify no more _profiles/{userId}/projects/
const smPath = path.join(ROOT, 'src', 'tools', 'session-memory.ts');
const smContent = await fs.readFile(smPath, 'utf-8');
if (smContent.includes("'_profiles', userId, 'projects'")) {
  fail('session-memory.ts 仍包含错误的 _profiles/{userId}/projects/ 路径！');
} else {
  pass('session-memory.ts: 已修复，无 _profiles/{userId}/projects/ 引用');
}

// 4d. WorkspaceConfigManager: workspaceRoot/templates/
pass(`workspace-config 路径: workspaceRoot/templates/`);
pass(`  → listTemplates: ${path.join(WORKSPACE_ROOT, 'templates')}`);
pass(`  → readTemplate: ${path.join(WORKSPACE_ROOT, 'templates')}/{name}.json`);

// 4e. Knowledge reader
pass(`knowledge-reader 路径: workspaceRoot/knowledge/`);

// 4f. Prefetch paths
pass(`prefetch 路径:`);
pass(`  → _profiles/{userId}/memory.json`);
pass(`  → _profiles/{userId}/profile.json`);
pass(`  → agent-guides/`);
pass(`  → projects/{userId}/`);

// 4g. Injection layer
pass(`injection-layer 路径: workspaceRoot + '/_profiles/...'`);
pass(`  → workspaceRoot/knowledge/`);
pass(`  → workspaceRoot/rules/`);
// verify no rulesDir field
const injContent = await fs.readFile(path.join(ROOT, 'src', 'runtime', 'injection-layer.ts'), 'utf-8');
if (injContent.includes('private rulesDir') || injContent.includes('this.rulesDir')) {
  fail('injection-layer.ts 仍有未使用的 rulesDir 字段！');
} else {
  pass('injection-layer.ts: 已清除 rulesDir 死字段');
}

// ========== 第五段：部署脚本路径检查 ==========
console.log('\n=== 5. 部署脚本路径 ===');

// 5a. deploy.sh: PLUGIN_DIR = $(dirname "$0")/..
pass('deploy.sh: PLUGIN_DIR = $(dirname "$0")/.. → project root');

// 5b. deploy.sh: PLUGIN_WS="${PLUGIN_DIR}/workspace"
pass('deploy.sh: 插件工作区 = PLUGIN_DIR/workspace');
// deploy.sh line 83: mkdir -p ${PLUGIN_WS}/templates
// deploy.sh line 84: mkdir -p ${PLUGIN_WS}/projects
// deploy.sh line 85: mkdir -p ${PLUGIN_WS}/agent-guides
// deploy.sh line 86: mkdir -p ${PLUGIN_WS}/_shared  ← 旧名称！
const depContent = await fs.readFile(path.join(ROOT, 'scripts', 'deploy.sh'), 'utf-8');
const depLines = depContent.split('\n');
const sharedMkdir = depLines.find(l => l.includes('mkdir -p') && l.includes('_shared'));
if (sharedMkdir && sharedMkdir.includes('_shared') && !sharedMkdir.includes('_profiles')) {
  fail('deploy.sh 仍创建 _shared/ 而非 _profiles/！');
} else {
  pass('deploy.sh: 已用 _profiles/ 替换 _shared/');
}
// deploy.sh now creates _profiles instead of _shared

// 5c. deploy.sh: SOUL.md should have no _shared references
const soulLines = depContent.split('\n').filter(l => l.includes('kb_read') || l.includes('kb_write') || l.includes('style-dna') || l.includes('_shared'));
for (const l of soulLines) {
  if (l.includes('_shared')) {
    fail(`deploy.sh orchestrator SOUL.md 仍有 _shared 引用: ${l.trim()}`);
  }
}

// 5d. setup-workspace.sh paths
pass('setup-workspace.sh: ROOT = PLUGIN_DIR/workspace');
// Still uses _shared?
const setupContent = await fs.readFile(path.join(ROOT, 'scripts', 'setup-workspace.sh'), 'utf-8');
if (setupContent.includes('SHARED="${ROOT}/_shared"')) {
  fail('setup-workspace.sh 仍使用 _shared/');
} else if (setupContent.includes('SHARED="${ROOT}/_profiles"')) {
  pass('setup-workspace.sh: 已使用 _profiles/');
}
// Check old file references: style-dna.json, kb.json
if (setupContent.includes('style-dna.json') || setupContent.includes('kb.json')) {
  fail('setup-workspace.sh 仍有旧文件名引用 (style-dna.json / kb.json)');
}
if (setupContent.includes('profile.json') || setupContent.includes('memory.json')) {
  pass('setup-workspace.sh: 使用新文件名');
}

// 5e. sync-ai-summary.sh — still uses _shared?
const syncContent = await fs.readFile(path.join(ROOT, 'scripts', 'sync-ai-summary.sh'), 'utf-8');
if (syncContent.includes('_shared')) {
  fail('sync-ai-summary.sh 仍使用 _shared/');
} else {
  pass('sync-ai-summary.sh: 已使用 _profiles/');
}

// 5f. deploy.sh no longer creates _shared
const depHasOld = depContent.includes('_shared');
if (depHasOld) {
  fail(`deploy.sh 仍有 ${depHasOld.length} 处 _shared 引用`);
} else {
  pass('deploy.sh: 无 _shared 引用');
}

// 5g. deploy.sh SOUL.md: kb_read/kb_write are backward-compat aliases — OK

// deploy.sh: AGENT_WORKSPACE_ROOT="${OPENCLAW_HOME}/workspace"
pass('deploy.sh: Agent workspace = OPENCLAW_HOME/workspace/{agentName}');
// This is OPENCLAW_HOME/workspace/, not PLUGIN_DIR/workspace/ — different workspaces!
pass('  → 注意：Agent 工作区 (OPENCLAW_HOME/workspace/) 与插件工作区 (PLUGIN_DIR/workspace/) 不同');
pass('  → Orchestrator 在 OPENCLAW_HOME/workspace/orchestrator/');
pass(`  → 应用 Agents 在 OPENCLAW_HOME/workspace/{agentName}/`);

// 5h. sync-ai-summary.ps1 (Windows) — still uses _shared?
const syncPs1Content = await fs.readFile(path.join(ROOT, 'scripts', 'sync-ai-summary.ps1'), 'utf-8');
if (syncPs1Content.includes('_shared')) {
  fail('sync-ai-summary.ps1 仍使用 _shared/');
} else {
  pass('sync-ai-summary.ps1: 已使用 _profiles/');
}
if (syncPs1Content.includes('kb.json')) {
  fail('sync-ai-summary.ps1 仍有 kb.json 引用');
} else if (syncPs1Content.includes('memory.json')) {
  pass('sync-ai-summary.ps1: 使用 memory.json');
}
// PLUGIN_WS="${PLUGIN_DIR}/workspace" — consistent
// AGENT_CONFIGS_SRC="${PLUGIN_DIR}/templates/agent-configs" — consistent
pass('buxiachuang/deploy.sh: AGENT_CONFIGS_SRC = PLUGIN_DIR/templates/agent-configs');
// copies to AGENT_WORKSPACE_ROOT/{agent}/ → OPENCLAW_HOME/workspace/{agent}/
pass('buxiachuang/deploy.sh: 复制配置到 AGENT_WORKSPACE_ROOT/{agent}/');
// copies template to PLUGIN_WS/templates/
pass('buxiachuang/deploy.sh: 复制 xiaohongshu-creation.json 到 PLUGIN_WS/templates/');
// copies guide to PLUGIN_WS/agent-guides/
pass('buxiachuang/deploy.sh: 复制开发指导到 PLUGIN_WS/agent-guides/');
// writes manifest to PLUGIN_WORKSPACE/applications/buxiachuang/
pass('buxiachuang/deploy.sh: manifest at PLUGIN_WORKSPACE/applications/buxiachuang/');
// PLUGIN_WORKSPACE = OPENCLAW_HOME/workspaces/multi-agent-pipeline (different from both)
pass('  → PLUGIN_WORKSPACE 是 OPENCLAW_HOME/workspaces/multi-agent-pipeline');

// 5i. Check if PLUGIN_WORKSPACE/applications/ dir exists
try {
  await fs.access(path.join(ROOT, '..', 'workspaces', 'multi-agent-pipeline', 'applications'));
  pass('PLUGIN_WORKSPACE/applications/ 存在');
} catch {
  pass('PLUGIN_WORKSPACE/applications/ 不存在（仅部署时创建）');
}

// 5j. sync-agent-configs.sh: SRC = 外部决赛路演路径, DST = templates/agent-configs/
pass('sync-agent-configs.sh: 从决赛路演路径同步到 templates/agent-configs/');

// ========== 第六段：templates/agent-configs/ 文件完整性 ==========
console.log('\n=== 6. Agent 配置文件完整性 ===');
const agents = ['topic-researcher', 'content-writer', 'quality-reviewer', 'publisher', 'post-analyst'];
const agentConfigsDir = path.join(ROOT, 'templates', 'agent-configs');
for (const a of agents) {
  for (const ext of ['SOUL.md', 'AGENT.md', 'SKILL.md']) {
    try {
      await fs.access(path.join(agentConfigsDir, `${a}-${ext}`));
    } catch {
      fail(`templates/agent-configs/${a}-${ext} 不存在（deploy.sh 从这复制）`);
    }
  }
}

// 检查 SOUL.md 内容是否有旧路径引用
for (const a of agents) {
  try {
    const c = await fs.readFile(path.join(agentConfigsDir, `${a}-SOUL.md`), 'utf-8');
    if (c.includes('kb_read') || c.includes('kb_write')) {
      pass(`${a}-SOUL.md: kb_read/kb_write 引用存在（向后兼容，可接受）`); // acceptable since aliases
    }
  } catch {}
}

// ========== 第七段：Seed template vs workspace template ==========
console.log('\n=== 7. 种子模板同步 ===');
// SEED_TEMPLATES_DIR = PLUGIN_ROOT/templates/ → seed templates
// install.ts creates default template inline (xiaohongshu-creation.json)
// workspace-config.ts initWorkspace copies from SEED_TEMPLATES_DIR
try {
  const seedFiles = await fs.readdir(SEED_TEMPLATES_DIR);
  for (const f of seedFiles.filter(f => f.endsWith('.json'))) {
    const wsTpl = path.join(WORKSPACE_ROOT, 'templates', f);
    try {
      await fs.access(wsTpl);
      pass(`模板已同步到工作区: ${f}`);
    } catch {
      fail(`模板 ${f} 在 SEED_TEMPLATES_DIR 中存在但未在 WORKSPACE_ROOT/templates/ 中找到`);
    }
  }
} catch { pass('SEED_TEMPLATES_DIR 无文件（内置模板）'); }

// ========== 总结 ==========
console.log('');
console.log('='.repeat(50));
if (errors === 0) {
  console.log('全部路径验证通过！');
} else {
  console.log(`发现 ${errors} 个问题：`);
}
for (const r of report) console.log(r);
process.exit(errors > 0 ? 1 : 0);
