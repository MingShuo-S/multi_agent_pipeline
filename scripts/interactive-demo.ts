#!/usr/bin/env tsx
// scripts/interactive-demo.ts - 人在回路的交互式 Demo
// 运行: npx tsx scripts/interactive-demo.ts
//
// 5 阶段接力流水线：
//   选题调研(自动) → 网络调研(自动) → 内容创作(对话) → 质量审核(对话) → 发布(自动)

import * as path from 'path';
import * as fs from 'fs/promises';
import { mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'tmp', `demo-${Date.now()}`);
const UID = 'demo-user';
const PID = `project-${Date.now()}`;
const TPL_NAME = 'demo-template';

const STAGES_META: Record<string, { label: string }> = {
  'topic-researcher': { label: '选题研究员' },
  'web-researcher':    { label: '网络调研员' },
  'content-writer':    { label: '内容创作者' },
  'quality-reviewer':  { label: '质量审核员' },
  'publisher':         { label: '发布专员' },
};

const DEMO_TEMPLATE = {
  name: TPL_NAME,
  description: '小红书创作接力流水线',
  mode: 'relay',
  stages: [
    { id: '选题调研', agent: 'topic-researcher', checkpoint: false, allow_read: ['*'], allow_write: ['topic'] },
    { id: '网络调研', agent: 'web-researcher', checkpoint: false, allow_read: ['topic'], allow_write: ['research_data'] },
    { id: '内容创作', agent: 'content-writer', checkpoint: true, allow_read: ['topic', 'research_data'], allow_write: ['draft'] },
    { id: '质量审核', agent: 'quality-reviewer', checkpoint: true, allow_read: ['draft'], allow_write: ['review'] },
    { id: '发布', agent: 'publisher', checkpoint: false, allow_read: ['draft', 'review'], allow_write: ['final'] },
  ],
  slots: {
    topic: { type: 'text', default: '' },
    research_data: { type: 'text', default: '' },
    draft: { type: 'text', default: '' },
    review: { type: 'text', default: '' },
    final: { type: 'text', default: '' },
  },
};

function makeResponse(agent: string, ctx: string): string {
  switch (agent) {
    case 'topic-researcher':
      return `[选题研究员] 选题方向已确定：南京红庙烟火气（美食+人文）。\n\n数据已写入 topic slot。`;
    case 'web-researcher':
      return `[网络调研员] 调研完成！\n\n- 红庙街区全长约800米，聚集30+家小吃\n- 人均消费30-50元\n- 周末客流约3000人次/天\n\n数据已写入 research_data slot。`;
    case 'content-writer': {
      if (ctx === '改') {
        return `[内容创作者] 已按你的意见修改：删除了"必吃"等营销感强的词汇，增加了体验感描述。`;
      }
      return `[内容创作者] 初稿已完成！\n\n**南京红庙：一条800米的老街，藏了30+家神级小吃**\n\n开头：来南京别只去夫子庙了，红庙才是本地人的快乐老家...\n\n你可以让我修改/润色，满意后输入"下一阶段"交给审核。`;
    }
    case 'quality-reviewer':
      return `[质量审核员] 审核完成！\n\n通过：语言风格符合小红书调性，信息准确。\n建议：增加具体店名和推荐菜，结尾加互动引导。\n\n回复修改意见，或输入"下一阶段"进入发布。`;
    case 'publisher':
      return `[发布专员] 发布预览已生成！\n\n标题：南京红庙｜本地人私藏的碳水天堂\n话题：#南京美食 #南京旅游 #citywalk\n\n项目完成！`;
    default:
      return `[${agent}] 已处理。`;
  }
}

async function setupWorkspace(): Promise<void> {
  mkdirSync(path.join(ROOT, 'templates'), { recursive: true });
  mkdirSync(path.join(ROOT, 'projects', UID, PID), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, 'templates', `${TPL_NAME}.json`),
    JSON.stringify(DEMO_TEMPLATE, null, 2),
    'utf-8'
  );
}

async function readState(): Promise<any> {
  try {
    const raw = await fs.readFile(path.join(ROOT, 'projects', UID, PID, 'state.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function main() {
  console.log(`\n${'='.repeat(56)}`);
  console.log(`  \u{1F3E0} 部虾创 - 接力模式交互式 Demo`);
  console.log(`  \u{1F4CD} 工作区: ${ROOT}`);
  console.log(`  \u{1F464} 用户: ${UID}`);
  console.log(`  \u{1F4C1} 项目: ${PID}`);
  console.log(`${'='.repeat(56)}\n`);

  await setupWorkspace();

  // mock subagent — 根据 sessionKey 中的 agent 名返回对应回复
  let msgCount = 0;
  let lastAgent = '';

  const mockSubagent = {
    run: async ({ sessionKey }: { sessionKey: string }) => {
      msgCount++;
      lastAgent = sessionKey.split(':')[0];
      return { runId: `run-${msgCount}` };
    },
    waitForRun: async () => ({ status: 'ok' as const }),
    getSessionMessages: async () => {
      const ctx = msgCount <= 3 ? '初稿' : '改';
      return {
        messages: [{ role: 'assistant' as const, content: makeResponse(lastAgent, ctx) }],
      };
    },
  };
  const mockApi = { runtime: { subagent: mockSubagent } };

  const prompt = (q: string) => new Promise<string>(r => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (answer) => { rl.close(); r(answer); });
  });

  // ── 首次启动 ──
  console.log('\u{1F680} 正在启动项目...\n');
  const { pipelineStart } = await import('../src/tools/pipeline-start.js');
  let result = await pipelineStart(TPL_NAME, UID, PID, '', ROOT, mockApi);

  if (result.status === 'initialized') {
    const s = result.status_panel!;
    console.log(`\u2705 项目已启动！当前阶段: ${s.completed_stages + 1}/${s.stages.length}`);
    console.log(`\u{1F9D1}\u{200D}\u{1F4BB} 当前专家: ${result.current_agent}`);
    console.log(`\u{1F4CB} 任务: ${result.stage_description || '无'}`);
    console.log(`\n${result.message}\n`);
  }

  // ── 主交互循环 ──
  const { pipelineContinue } = await import('../src/tools/pipeline-continue.js');

  while (true) {
    const input = await prompt(`\u{1F464} 你 > `);

    if (!input.trim()) continue;
    if (input === 'exit' || input === 'quit') {
      console.log('\n\u{1F44B} 再见！');
      break;
    }
    if (input === 'status') {
      const state = await readState();
      if (state) {
        console.log(`\n\u{1F4CA} 状态: ${state.status}`);
        console.log(`   当前阶段: ${state.current_stage + 1}`);
        console.log(`   已完成阶段: ${state.stage_history.filter((s: any) => s.completed_at).length}`);
        for (const [k, v] of Object.entries(state.slot_values)) {
          if (v) console.log(`   [${k}]: ${String(v).substring(0, 60)}...`);
        }
      }
      continue;
    }
    if (input === 'slots') {
      const state = await readState();
      if (state) {
        for (const [k, v] of Object.entries(state.slot_values)) {
          console.log(`\n[${k}]`);
          console.log(String(v).substring(0, 300));
        }
      }
      continue;
    }

    const isAdv = ['下一阶段', '下一步', '推进', 'advance', 'next', '完成', '过', 'pass'].some(
      kw => input.trim().toLowerCase() === kw.toLowerCase()
    );
    if (isAdv) msgCount = 0;

    result = await pipelineContinue(UID, PID, input, ROOT, mockApi);

    if (result.status === 'completed') {
      console.log(`\n\u{1F389} ${result.message}`);
      console.log('\n\u{1F4E6} 最终产出:');
      const state = await readState();
      if (state) {
        for (const [k, v] of Object.entries(state.slot_values)) {
          if (v) { console.log(`\n\u{1F4C4} [${k}]\n${String(v).substring(0, 500)}`); }
        }
      }
      break;
    }

    if (result.status === 'error') {
      console.log(`\n\u{274C} 错误: ${result.error}`);
      break;
    }

    if (result.status_panel) {
      const p = result.status_panel;
      console.log(`\n\u{1F4CA} 进度: ${p.completed_stages}/${p.stages.length} 阶段完成`);
      console.log(`   ${p.stages.map((s: any) =>
        s.status === 'completed' ? `\u2705${s.id}`
          : s.status === 'current' ? `\u25B6\u{FE0F}${s.id}${s.checkpoint ? ' \u{1F6A9}' : ''}`
          : `\u23F3${s.id}`
      ).join(' ')}`);
    }

    if (result.status === 'stage_advanced') {
      console.log(`\n\u{1F504} ${result.message}\n`);
    }

    if (result.status === 'dialogue_continued' && result.slot_output) {
      const val = typeof result.slot_output.value === 'string'
        ? result.slot_output.value : JSON.stringify(result.slot_output.value, null, 2);
      console.log(`\n${val}\n`);
    }
  }
}

main().catch(err => {
  console.error('Demo 出错:', err);
  process.exit(1);
});
