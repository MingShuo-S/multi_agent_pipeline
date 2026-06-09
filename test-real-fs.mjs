// 真实文件系统集成测试
// 模拟 pipeline_start 的完整流程，不 mock fs
// TestStateManager 也作为 fallback 导出供 test-server-flow.mjs 使用

import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mkdtempSync, rmSync } from 'fs'

// 手动实现 StateManager 核心逻辑（避免 import 时触发 vi.mock）
// 直接从源码复制的逻辑

const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 2000

function applyReducer(current, content, reducer) {
  if (reducer === 'append' && typeof current === 'string' && typeof content === 'string') {
    return current + '\n' + content
  }
  if (reducer === 'merge' && typeof current === 'object' && typeof content === 'object') {
    return { ...current, ...content }
  }
  return content
}

export class TestStateManager {
  constructor(workspaceRoot, userId, projectId) {
    this.workspaceRoot = workspaceRoot
    this.userId = userId
    this.projectId = projectId
    this.statePath = path.join(workspaceRoot, 'projects', userId, projectId, 'state.json')
    this.lockDir = path.join(workspaceRoot, 'projects', userId, projectId)
  }

  async withLock(label, fn) {
    const lockFile = path.join(this.lockDir, '.state.lock')
    console.log(`[withLock] label=${label}, lockDir=${this.lockDir}`)
    console.log(`[withLock] lockFile=${lockFile}`)

    // Step 1: mkdir
    try {
      await fs.mkdir(this.lockDir, { recursive: true })
      console.log(`[withLock] mkdir OK`)
    } catch (e) {
      console.log(`[withLock] mkdir FAIL: ${e.code} ${e.message}`)
      throw e
    }

    // Step 2: verify directory exists
    try {
      const stat = await fs.stat(this.lockDir)
      console.log(`[withLock] stat OK: isDirectory=${stat.isDirectory()}`)
    } catch (e) {
      console.log(`[withLock] stat FAIL after mkdir: ${e.code} ${e.message}`)
      throw e
    }

    // Step 3: write lock
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    let lastError = null
    while (Date.now() < deadline) {
      try {
        const content = `${process.pid || 0}\n${label}`
        console.log(`[withLock] attempting writeFile(${lockFile})`)
        await fs.writeFile(lockFile, content, { flag: 'wx' })
        console.log(`[withLock] writeFile OK`)
        break
      } catch (err) {
        if (err.code === 'EEXIST') {
          console.log(`[withLock] lock exists, retrying...`)
          await new Promise(r => setTimeout(r, LOCK_RETRY_MS))
          lastError = err
        } else {
          console.log(`[withLock] writeFile FAIL: ${err.code} ${err.message}`)
          throw err
        }
      }
    }

    if (Date.now() >= deadline && lastError) {
      throw new Error(`Lock timeout: ${label}`)
    }

    try {
      return await fn()
    } finally {
      await fs.unlink(lockFile).catch(() => {})
      console.log(`[withLock] lock released`)
    }
  }

  async initialize(template) {
    return this.withLock('initialize', async () => {
      const state = {
        template_name: template.name,
        current_stage: 0,
        slot_values: {},
        slot_history: {},
        remarks: [],
        stage_history: [],
        status: 'running',
        mode: template.mode || 'relay',
        pending_interrupt: null,
      }

      // init schema slots
      if (template.schema) {
        for (const layer of ['input', 'working', 'output']) {
          if (template.schema[layer]) {
            for (const [name, def] of Object.entries(template.schema[layer])) {
              const defaultVal = def.default ?? ''
              state.slot_values[name] = defaultVal
              state.slot_history[name] = []
            }
          }
        }
      }

      // init legacy slots
      if (template.slots) {
        for (const [name, def] of Object.entries(template.slots)) {
          if (!(name in state.slot_values)) {
            state.slot_values[name] = def.default
          }
          if (!state.slot_history[name]) {
            state.slot_history[name] = []
          }
        }
      }

      if (template.stages.length > 0) {
        state.stage_history.push({
          stage: 0,
          stage_id: template.stages[0].id,
          agent: template.stages[0].agent,
          started_at: new Date().toISOString(),
          versions: 0,
        })
      }

      await this._saveInternal(state)
      return state
    })
  }

  async _saveInternal(state) {
    const dir = path.dirname(this.statePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  async load() {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8')
      return JSON.parse(content)
    } catch (err) {
      const loadErr = new Error(`Failed to load state from ${this.statePath}: ${err.message}`)
      loadErr.code = err.code
      throw loadErr
    }
  }

  async save(state) {
    return this.withLock('save', async () => {
      await this._saveInternal(state)
    })
  }

  async updateSlot(slotName, content, agent, reducer = 'replace') {
    return this.withLock(`updateSlot:${slotName}`, async (state) => {
      // fake — we don't need exact param passing for this test
    })
  }

  async advanceStage() {
    return this.withLock('advanceStage', async () => {
      const state = await this._loadInternal()
      const current = state.stage_history.find(h => h.stage === state.current_stage && !h.completed_at)
      if (current) current.completed_at = new Date().toISOString()
      state.current_stage += 1
      await this._saveInternal(state)
      return state
    })
  }

  async _loadInternal() {
    const content = await fs.readFile(this.statePath, 'utf-8')
    return JSON.parse(content)
  }
}

// ========== Test Main ==========

async function main() {
  const tmpDir = mkdtempSync(path.join(process.cwd(), 'tmp-test-'))
  console.log(`\n=== 测试目录: ${tmpDir} ===\n`)

  const TMP = tmpDir
  const WR = path.join(TMP, 'workspace')
  const UID = 'default-user'
  const PID = `test-project-${Date.now()}`
  const TEMPLATE_NAME = 'xiaohongshu-creation'

  let passed = 0
  let failed = 0

  async function test(name, fn) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`)
      console.log(`    ${e.stack?.split('\n').slice(0, 3).join('\n    ')}`)
      failed++
    }
  }

  // Setup: create workspace with template
  const srcTemplateDir = path.resolve(process.cwd(), 'templates')
  const dstTemplateDir = path.join(WR, 'templates')

  // ---- Test 1: Workspace init ----
  await test('initWorkspace — creates directories', async () => {
    await fs.mkdir(dstTemplateDir, { recursive: true })
    await fs.mkdir(path.join(WR, 'projects'), { recursive: true })
    const stat = await fs.stat(dstTemplateDir)
    if (!stat.isDirectory()) throw new Error('workspace template dir not created')
  })

  // ---- Test 2: Copy template ----
  await test('copy template', async () => {
    const src = path.join(srcTemplateDir, `${TEMPLATE_NAME}.json`)
    const dst = path.join(dstTemplateDir, `${TEMPLATE_NAME}.json`)
    await fs.copyFile(src, dst)
    const content = await fs.readFile(dst, 'utf-8')
    const parsed = JSON.parse(content)
    if (parsed.name !== TEMPLATE_NAME) throw new Error(`template name mismatch: ${parsed.name}`)
    console.log(`    template: ${parsed.description}`)
    console.log(`    stages: ${parsed.stages.length}`)
  })

  // ---- Test 3: StateManager constructor + withLock ----
  let sm
  await test('StateManager constructor', async () => {
    sm = new TestStateManager(WR, UID, PID)
    if (!sm.lockDir.includes(UID)) throw new Error('lockDir malformed')
    if (!sm.lockDir.includes(PID)) throw new Error('lockDir malformed')
    console.log(`    lockDir: ${sm.lockDir}`)
    console.log(`    statePath: ${sm.statePath}`)
  })

  // ---- Test 4: Initialize (withLock → mkdir → write lock → save state) ----
  let template
  await test('initialize — full withLock flow', async () => {
    const templateContent = await fs.readFile(path.join(dstTemplateDir, `${TEMPLATE_NAME}.json`), 'utf-8')
    template = JSON.parse(templateContent)

    const state = await sm.initialize(template)

    if (state.status !== 'running') throw new Error(`status != running`)
    if (state.current_stage !== 0) throw new Error(`current_stage != 0`)
    if (state.stage_history.length !== 1) throw new Error(`stage_history length != 1`)
    console.log(`    status: ${state.status}`)
    console.log(`    slots: ${Object.keys(state.slot_values).join(', ')}`)
    console.log(`    stage 0: ${state.stage_history[0].agent} / ${state.stage_history[0].stage_id}`)
  })

  // ---- Test 5: Load after initialize ----
  await test('load after initialize', async () => {
    const state = await sm.load()
    if (state.status !== 'running') throw new Error('loaded state not running')
    if (state.template_name !== TEMPLATE_NAME) throw new Error('template_name mismatch')
  })

  // ---- Test 6: withLock disk state — verify no stale lock ----
  await test('no stale lock file', async () => {
    const lockFile = path.join(sm.lockDir, '.state.lock')
    try {
      await fs.access(lockFile)
      throw new Error('lock file still exists after withLock released')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  })

  // ---- Test 7: Save with withLock ----
  await test('save with withLock', async () => {
    const state = await sm.load()
    state.author = 'test-user'
    await sm.save(state)
    const reloaded = await sm.load()
    if (reloaded.author !== 'test-user') throw new Error('author not persisted')
  })

  // ---- Test 8: Load fresh from new StateManager ----
  await test('load from fresh StateManager instance', async () => {
    const sm2 = new TestStateManager(WR, UID, PID)
    const state = await sm2.load()
    if (state.template_name !== TEMPLATE_NAME) throw new Error('fresh load: template_name mismatch')
    if (state.status !== 'running') throw new Error('fresh load: status mismatch')
    console.log(`    fresh load OK: stage=${state.current_stage}, slots=${Object.keys(state.slot_values).length}`)
  })

  // ---- Test 9: Multiple withLock in sequence ----
  await test('multiple withLock sequential — no ENOENT', async () => {
    for (let i = 0; i < 5; i++) {
      const state = await sm.load()
      state.slot_values[`test_key_${i}`] = `value_${i}`
      await sm.save(state)
    }
    const final = await sm.load()
    for (let i = 0; i < 5; i++) {
      if (final.slot_values[`test_key_${i}`] !== `value_${i}`) {
        throw new Error(`test_key_${i} not persisted`)
      }
    }
    console.log(`    5 sequential save+load cycles OK`)
  })

  // ---- Test 10: Pipeline-start simulation (no subagent) ----
  await test('pipeline_start simulation', async () => {
    // Same flow as pipelineStart but without callSubagent
    const configManager = { readTemplate: async (name) => {
      const content = await fs.readFile(path.join(WR, 'templates', `${name}.json`), 'utf-8')
      return JSON.parse(content)
    }}

    const tpl = await configManager.readTemplate(TEMPLATE_NAME)

    // Try loading existing state
    let state
    try {
      state = await sm.load()
      console.log(`    existing state found: stage=${state.current_stage}`)
    } catch {
      state = await sm.initialize(tpl)
      console.log(`    fresh initialize done`)
    }

    if (!state) throw new Error('no state after init')
    if (!state.template_name) throw new Error('state missing template_name')
    console.log(`    state OK: template=${state.template_name}, stage=${state.current_stage}/${tpl.stages.length}`)
  })

  // ---- Test 11: Template path simulation (run from dist/) ----
  await test('simulate WORKSPACE_ROOT from dist/ path', async () => {
    // Simulate the config.ts logic: __dirname = dist/runtime/
    // pluginRoot = join(__dirname, '..') = dist/
    // WORKSPACE_ROOT = join(pluginRoot, 'workspace')
    const simulateDirname = path.join(TMP, 'dist', 'runtime')
    await fs.mkdir(simulateDirname, { recursive: true })
    const pluginRoot = path.join(simulateDirname, '..')
    const derivedWsRoot = path.join(pluginRoot, 'workspace')
    // If the test workspace was initialized at TMP/workspace, this would be TMP/dist/workspace — mismatch!
    console.log(`    dist/ scenario: pluginRoot=${pluginRoot}`)
    console.log(`    derived workspaceRoot=${derivedWsRoot}`)
    console.log(`    actual workspaceRoot=${WR}`)
    if (derivedWsRoot !== WR) {
      console.log(`    ⚠ PATH MISMATCH: if running from dist/, WORKSPACE_ROOT would be ${derivedWsRoot}`)
      console.log(`    but the project templates are at ${WR}/templates/`)
    }
  })

  // ========== Summary ==========
  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===\n`)

  // Cleanup
  rmSync(TMP, { recursive: true, force: true })
  console.log(`Cleaned up ${TMP}`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(`FATAL: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
