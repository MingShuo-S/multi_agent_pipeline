#!/usr/bin/env npx tsx
/**
 * 本地端到端测试 — 不走 OpenClaw，直接调插件函数
 * 测试流程：Voiceprint → pipeline_start → 多轮对话 → 乱序调整 → 出文
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(__dirname, '..');
// WORKSPACE_ROOT 应该指向 workspace/ 目录，模板在 workspace/templates/ 下
const WORKSPACE_ROOT = path.join(PLUGIN_ROOT, 'workspace');

// 模拟 subagent API（不调真实 LLM）
const responses: Record<string, string> = {
  'topic-researcher': `【选题调研】\n\n基于你的需求，我确定了以下选题方向：\n\n**主题**: 南京骑行路线探索\n**目标受众**: 大学生、骑行爱好者\n**核心卖点**: 25元玩一天的高性价比路线\n\n调研数据:\n- 路线：红庙→朝天宫→莫愁湖公园\n- 全程约4-5公里，骑行30分钟\n- 门票：朝天宫25元（学生半价），莫愁湖免费\n- 共享单车：1.5元/30分钟\n\n已写入 topic_brief 和 research_notes slot。`,
  'content-writer': `【内容创作】\n\n基于选题和调研数据，我写了初稿：\n\n---\n标题：《南京烟火气骑行｜红庙→莫愁湖，25元玩一天》\n\n来南京不吃鸭血粉丝汤等于白来！但今天不聊吃的，聊聊怎么花25块钱骑车逛完南京最烟火气的一条线。\n\n📍 路线：红庙→朝天宫→莫愁湖公园\n🚲 全程约4公里，骑行30分钟\n💰 总花费：25元（朝天宫门票）\n\n红庙的早餐摊子5块钱一碗鸭血粉丝，朝天宫25块钱看600年历史，莫愁湖免费发呆一下午。\n\n这就是南京——烟火气和历史感，骑个车就串起来了。\n\n#南京骑行 #南京攻略 #25元玩一天\n---\n\n已写入 draft_content slot。`,
  'quality-reviewer': `【质量审核】\n\n审核报告：\n\n✅ 事实核查：通过\n- 路线数据与调研一致\n- 价格信息准确\n\n✅ 原创性：通过\n- 无撞车风险\n\n✅ 平台规则：通过\n- 无敏感词\n- 符合小红书写法\n\n✅ 写作质量：良好\n- 结构清晰\n- 语气轻松\n\n**结论：通过**\n\n已写入 review_feedback slot。`,
  'publisher': `【发布准备】\n\n标题优化（3个候选）：\n1. 南京烟火气骑行｜红庙→莫愁湖，25元玩一天 🔥\n2. 南京本地人私藏路线！25块钱骑车逛烟火气\n3. 来南京别只吃鸭血粉丝！这条骑行路线更绝\n\n推荐：第1个（数字+emoji吸引点击）\n\n标签：#南京骑行 #南京攻略 #南京美食 #骑行路线 #大学生旅行 #烟火气 #南京一日游\n\n发布检查清单：\n- [x] AI标注（本文由AI辅助创作）\n- [x] 无敏感词\n- [x] 符合小红书格式\n\n已写入 final_output slot。`,
};

const mockSubagent = {
  async run(params: { sessionKey: string; message: string }) {
    return { runId: `mock-${Date.now()}` };
  },
  async waitForRun() { return { status: 'ok' as const }; },
  async getSessionMessages(params: { sessionKey: string; limit?: number }) {
    const agent = params.sessionKey.split(':')[0];
    const content = responses[agent] || `[${agent}] 已处理`;
    return {
      messages: [{ role: 'assistant', content }]
    };
  },
};

// 模拟 fs 操作（用内存模拟）
const mockFiles = new Map<string, string>();

function norm(p: string) { return p.replace(/\\/g, '/'); }

// 导入插件函数
import { pipelineStart } from '../src/tools/pipeline-start.js';
import { pipelineContinue } from '../src/tools/pipeline-continue.js';
import { pipelineDisplay } from '../src/tools/pipeline-display.js';
import { pipelineStatus } from '../src/tools/pipeline-status.js';

const USER_ID = 'test-user';
const PROJECT_ID = 'e2e-test-001';

async function main() {
  console.log('========================================');
  console.log('  部虾创 本地端到端测试');
  console.log('========================================\n');

  // 清理旧项目
  const fs = await import('fs');
  const stateDir = path.join(WORKSPACE_ROOT, 'projects', USER_ID, PROJECT_ID);
  try { await fs.promises.rm(stateDir, { recursive: true }); } catch {}

  // 确保工作区存在
  await fs.promises.mkdir(path.join(WORKSPACE_ROOT, 'templates'), { recursive: true });
  await fs.promises.mkdir(stateDir, { recursive: true });

  // 复制模板
  const tplSrc = path.join(PLUGIN_ROOT, 'templates', 'xiaohongshu-creation.json');
  const tplDst = path.join(WORKSPACE_ROOT, 'templates', 'xiaohongshu-creation.json');
  try { await fs.promises.copyFile(tplSrc, tplDst); } catch {}

  const api = { runtime: { subagent: mockSubagent as any } };

  // 调试：检查实际路径
  const { WORKSPACE_ROOT: WR } = await import('../src/config.js');
  console.log('WORKSPACE_ROOT:', WR);
  console.log('模板路径:', path.join(WR, 'templates', 'xiaohongshu-creation.json'));
  console.log('模板存在:', fs.existsSync(path.join(WR, 'templates', 'xiaohongshu-creation.json')));

  // ===== 阶段 0: Voiceprint（风格快照）=====
  console.log('【阶段 0: Voiceprint 风格快照】');
  console.log('模拟：跳过 voiceprint，直接使用默认风格\n');

  // ===== 阶段 1: 启动管道 =====
  console.log('【阶段 1: 启动管道】');
  const startResult = await pipelineStart(
    'xiaohongshu-creation',
    USER_ID,
    PROJECT_ID,
    '我想写一篇南京骑行路线的小红书笔记',
    WORKSPACE_ROOT,
    api
  );
  console.log(`状态: ${startResult.status}`);
  console.log(`阶段: ${startResult.current_stage_name}`);
  console.log(`专家: ${startResult.current_agent}`);
  console.log(`消息: ${startResult.message.substring(0, 200)}...\n`);

  // ===== 阶段 2: 与 topic-researcher 对话 =====
  console.log('【阶段 2: 选题调研对话】');
  console.log('用户: "目标受众是大学生，预算25元以内"');
  const researchResult = await pipelineContinue(
    USER_ID, PROJECT_ID,
    '目标受众是大学生，预算25元以内',
    WORKSPACE_ROOT, api
  );
  console.log(`状态: ${researchResult.status}`);
  console.log(`专家: ${researchResult.current_agent}`);
  console.log(`回复: ${researchResult.message.substring(0, 300)}...\n`);

  // ===== 阶段 3: 乱序调整（用户想改选题）=====
  console.log('【阶段 3: 乱序调整 — 用户想加一个点】');
  console.log('用户: "能不能加上莫愁湖公园？那里有个亭子特别出片"');
  const adjustResult = await pipelineContinue(
    USER_ID, PROJECT_ID,
    '能不能加上莫愁湖公园？那里有个亭子特别出片',
    WORKSPACE_ROOT, api
  );
  console.log(`状态: ${adjustResult.status}`);
  console.log(`回复: ${adjustResult.message.substring(0, 300)}...\n`);

  // ===== 阶段 4: 推进到内容创作 =====
  console.log('【阶段 4: 推进到内容创作】');
  console.log('用户: "下一阶段"');
  const advanceResult = await pipelineContinue(
    USER_ID, PROJECT_ID,
    '下一阶段',
    WORKSPACE_ROOT, api
  );
  console.log(`状态: ${advanceResult.status}`);
  console.log(`阶段: ${advanceResult.current_stage_name}`);
  console.log(`专家: ${advanceResult.current_agent}`);
  console.log(`消息: ${advanceResult.message.substring(0, 300)}...\n`);

  // ===== 阶段 5: 与 content-writer 对话 =====
  console.log('【阶段 5: 内容创作对话】');
  console.log('用户: "语气轻松一点，加一些emoji"');
  const writeResult = await pipelineContinue(
    USER_ID, PROJECT_ID,
    '语气轻松一点，加一些emoji',
    WORKSPACE_ROOT, api
  );
  console.log(`状态: ${writeResult.status}`);
  console.log(`回复: ${writeResult.message.substring(0, 400)}...\n`);

  // ===== 阶段 6: 查看当前状态 =====
  console.log('【阶段 6: 查看管道状态】');
  const status = await pipelineStatus(USER_ID, PROJECT_ID, WORKSPACE_ROOT);
  console.log(`模板: ${status.project.template_name}`);
  console.log(`进度: ${status.progress.current_stage}/${status.progress.total_stages}`);
  console.log(`当前专家: ${status.progress.current_agent}`);
  console.log(`已写入 slot:`);
  for (const slot of status.slots) {
    if (slot.version_count > 0) {
      console.log(`  - ${slot.name}: ${slot.version_count} 个版本`);
    }
  }
  console.log(`批注: ${status.remarks.length} 条\n`);

  // ===== 阶段 7: 使用 pipeline_display 查看输出 =====
  console.log('【阶段 7: pipeline_display 查看输出】');
  const display = await pipelineDisplay(USER_ID, PROJECT_ID, WORKSPACE_ROOT);
  console.log(display);

  console.log('\n========================================');
  console.log('  测试完成！');
  console.log('========================================');
}

main().catch(console.error);
