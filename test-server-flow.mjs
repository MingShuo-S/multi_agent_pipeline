// 服务器集成测试 — 直接用 dist/ 编译后的代码
// 在服务器上运行: node test-server-flow.mjs
// 会创建临时测试目录，模拟 pipeline_start 完整流程

import { promises as fs, mkdtempSync, rmSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const TEMPLATES = path.join(__dirname, 'templates')

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL  ${name}`)
    console.log(`        ${e.message}`)
    if (e.stack) {
      const lines = e.stack.split('\n').slice(1, 4)
      for (const l of lines) console.log(`        ${l.trim()}`)
    }
    failed++
  }
}

async function main() {
  const tmpDir = mkdtempSync(path.join(__dirname, 'server-test-'))
  console.log(`\n=== 测试目录: ${tmpDir} ===`)
  console.log(`=== Node: ${process.version} ===`)

  const WR = path.join(tmpDir, 'workspace')
  const UID = 'default-user'
  const PID = `server-test-${Date.now()}`
  const TPL = 'xiaohongshu-creation'

  // ====== 1. Import compiled modules ======
  function importLocal(p) {
    const resolved = path.resolve(p)
    return import('file://' + (process.platform === 'win32' ? '/' + resolved.replace(/\\/g, '/') : resolved))
  }

  let StateManager, WorkspaceConfigManager, initWorkspace
  try {
    const smModule = await importLocal(path.join(DIST, 'runtime/state-manager.js'))
    StateManager = smModule.StateManager
    console.log(`  StateManager imported ✓`)
  } catch (e) {
    console.log(`  FAIL to import StateManager: ${e.message}`)
    failed++
  }

  try {
    const wcModule = await importLocal(path.join(DIST, 'tools/workspace-config.js'))
    WorkspaceConfigManager = wcModule.WorkspaceConfigManager
    initWorkspace = wcModule.initWorkspace
    console.log(`  WorkspaceConfigManager imported ✓`)
  } catch (e) {
    console.log(`  FAIL to import WorkspaceConfigManager: ${e.message}`)
    failed++
  }

  // ====== 2. Init workspace (real directories) ======
  if (initWorkspace) {
    await test('initWorkspace creates directories + templates', async () => {
      const result = await initWorkspace(WR)
      console.log(`    created ${result.created.length} files/dirs`)
      if (!result.created.some(c => c.includes('templates'))) {
        throw new Error('templates not created')
      }
    })
  } else {
    // manual init
    await test('manual workspace init', async () => {
      await fs.mkdir(path.join(WR, 'templates'), { recursive: true })
      await fs.mkdir(path.join(WR, 'projects'), { recursive: true })
      const src = path.join(TEMPLATES, `${TPL}.json`)
      const dst = path.join(WR, 'templates', `${TPL}.json`)
      await fs.copyFile(src, dst)
    })
  }

  // ====== 3. StateManager CRUD ======
  if (!StateManager) {
    // Fallback: manual implementation of StateManager for LF test
    console.log('  Using fallback TestStateManager (LF test only)')
    StateManager = (await importLocal(path.join(__dirname, 'test-real-fs.mjs'))).TestStateManager
  }

  // Read template first
  let template
  if (WorkspaceConfigManager) {
    await test('readTemplate', async () => {
      const cm = new WorkspaceConfigManager(WR)
      template = await cm.readTemplate(TPL)
      console.log(`    stages: ${template.stages.length}`)
    })
  } else {
    await test('readTemplate (manual)', async () => {
      const content = await fs.readFile(path.join(WR, 'templates', `${TPL}.json`), 'utf-8')
      template = JSON.parse(content)
      console.log(`    stages: ${template.stages.length}`)
    })
  }

  // Initialize StateManager
  let sm
  await test('StateManager constructor', async () => {
    sm = new StateManager(WR, UID, PID)
    console.log(`    lockDir: ${sm.lockDir}`)
    console.log(`    statePath: ${sm.statePath}`)
  })

  // 3b. Initialize — this is where withLock calls fs.mkdir
  await test('StateManager.initialize (withLock → mkdir → writeFile)', async () => {
    const state = await sm.initialize(template, template.mode || 'relay')
    if (state.status !== 'running') throw new Error(`status=${state.status}`)
    if (state.current_stage !== 0) throw new Error(`stage=${state.current_stage}`)
    const slots = Object.keys(state.slot_values)
    console.log(`    status=running, stage=0, ${slots.length} slots`)
  })

  // 3c. Load
  await test('StateManager.load', async () => {
    const state = await sm.load()
    if (state.template_name !== TPL) throw new Error(`name=${state.template_name}`)
    console.log(`    template=${state.template_name}, status=${state.status}`)
  })

  // 3d. Update slot (calls withLock again)
  await test('StateManager.updateSlot', async () => {
    await sm.updateSlot('article_idea', 'test content', 'topic-researcher')
    const state = await sm.load()
    if (state.slot_values.article_idea !== 'test content') throw new Error('slot not updated')
    console.log(`    slot_value=${state.slot_values.article_idea}`)
  })

  // 3e. Advance stage
  await test('StateManager.advanceStage', async () => {
    const state = await sm.advanceStage()
    if (state.current_stage !== 1) throw new Error(`stage=${state.current_stage}`)
    console.log(`    advanced to stage ${state.current_stage}`)
  })

  // 3f. Multiple sequential withLock calls (stress test)
  await test('sequential withLock (5 cycles)', async () => {
    for (let i = 0; i < 5; i++) {
      await sm.updateSlot('target_audience', `cycle-${i}`, 'topic-researcher')
    }
    const state = await sm.load()
    console.log(`    slot value: ${state.slot_values.target_audience}`)
  })

  // 3g. Completing a stage
  await test('completeCurrentStage', async () => {
    await sm.completeCurrentStage()
    const state = await sm.load()
    const completed = state.stage_history.filter(s => s.completed_at)
    console.log(`    ${completed.length}/${state.stage_history.length} stages completed`)
  })

  // ====== 4. Check lock file is cleaned up ======
  await test('no stale .state.lock after all operations', async () => {
    const lockFile = path.join(sm.lockDir, '.state.lock')
    try {
      await fs.access(lockFile)
      throw new Error('stale lock file found!')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  })

  // ====== 5. Fresh project — simulate brand new directory ======
  await test('fresh project: create StateManager + initialize on non-existing dir', async () => {
    const pid2 = `fresh-${Date.now()}`
    const sm2 = new StateManager(WR, UID, pid2)
    const state = await sm2.initialize(template, template.mode || 'relay')
    if (state.status !== 'running') throw new Error('fresh init failed')
    console.log(`    fresh project ${pid2} initialized OK`)
  })

  // ====== 6. Verify WORKSPACE_ROOT path from compiled config ======
  await test('WORKSPACE_ROOT path check', async () => {
    const configModule = await importLocal(path.join(DIST, 'config.js'))
    const wsRoot = configModule.WORKSPACE_ROOT
    console.log(`    WORKSPACE_ROOT = ${wsRoot}`)
  })

  // ====== Summary ======
  const total = passed + failed
  console.log(`\n=== ${passed}/${total} tests passed ===\n`)

  // Cleanup
  rmSync(tmpDir, { recursive: true, force: true })
  console.log(`Cleaned up ${tmpDir}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(`\nFATAL: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
