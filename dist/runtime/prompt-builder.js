// src/runtime/prompt-builder.ts - 为 Agent 组装完整 Prompt
import { ToolAuth } from '../tools/tool-auth.js';
import { AgentGuideGenerator } from '../tools/agent-guide-generator.js';
export class PromptBuilder {
    constructor(workspaceRoot, userId, projectId) {
        this.workspaceRoot = workspaceRoot;
        this.userId = userId;
        this.projectId = projectId;
    }
    /**
     * 为管道调用构建 Prompt
     */
    async buildPipelinePrompt(agentName, template, state, profile, userMessage) {
        const stage = template.stages[state.current_stage];
        // 读取协作指南
        const guideGen = new AgentGuideGenerator(this.workspaceRoot);
        const guide = await guideGen.readGuide(agentName);
        // 获取允许的 slot 列表
        const readableSlots = ToolAuth.getReadableSlots(template, state.current_stage);
        const writableSlots = ToolAuth.getWritableSlots(template, state.current_stage);
        // 构建 Slot 内容列表
        const slotContent = this.buildSlotContent(state, readableSlots);
        // 构建 Prompt
        const promptParts = [];
        // 1. 强制系统指令
        promptParts.push(`【强制系统指令】\n` +
            `你是 ${agentName}。你的 SOUL 和行为风格由你的 SOUL.md 定义，请严格遵守。\n` +
            `当前你正在参与一个多 Agent 管道项目，项目模板：${template.name}，阶段：${stage.id}。\n`);
        // 2. 协作规则
        promptParts.push(`【协作规则】\n` +
            `- 你**必须**使用以下管道工具来获取上下文和产出结果：\n` +
            `  - pipeline_read(slot_name)  读取其他 Agent 提供的信息\n` +
            `  - pipeline_write_slot(slot_name, content)  提交你的产出\n` +
            `  - pipeline_add_remark(content)  对其他 Agent 或流程提出评论\n` +
            `- 除管道工具外，你还可以使用你原本具备的所有工具来完成任务。\n` +
            `- 你只能读取当前阶段允许的 slot：${readableSlots.join(', ')}\n` +
            `- 你只能写入当前阶段允许的 slot：${writableSlots.join(', ')}\n` +
            `- 不要尝试访问未授权的 slot，否则工具会拒绝。\n`);
        // 3. 长期记忆
        if (profile && profile.preferences) {
            promptParts.push(`【长期记忆】\n` +
                `以下是你对该用户的已知偏好（来自 profile.json）：\n` +
                `${JSON.stringify(profile.preferences, null, 2)}\n`);
        }
        // 4. 当前管道上下文
        promptParts.push(`【当前管道上下文】\n` +
            `以下 slot 的内容是你有权查看的：\n` +
            slotContent + '\n');
        // 5. 协作指南（可选）
        if (guide) {
            promptParts.push(`【协作指南】\n` +
                guide + '\n');
        }
        // 6. 用户任务
        if (userMessage) {
            // 对话模式
            promptParts.push(`【用户消息】\n` +
                userMessage + '\n');
        }
        else {
            // 管道自动调用
            promptParts.push(`【任务】\n` +
                `请根据上下文和你的职责，完成本阶段工作，并将结果写入指定 slot。\n`);
        }
        // 7. 重要提醒
        promptParts.push(`【重要提醒】\n` +
            `- 完成任务后，请调用 style_record_feedback 更新你对用户的长期记忆（如果观察到了新偏好）。\n` +
            `- 确保所有产出都通过 pipeline_write_slot 写入指定的 slot。\n`);
        return promptParts.join('\n');
    }
    buildSlotContent(state, readableSlots) {
        const lines = [];
        for (const slotName of readableSlots) {
            if (slotName in state.slot_values) {
                const value = state.slot_values[slotName];
                const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
                lines.push(`- **${slotName}**:\n${this.indent(content, 2)}`);
            }
        }
        return lines.length > 0 ? lines.join('\n') : '（暂无 Slot 内容）';
    }
    indent(text, spaces) {
        const indent = ' '.repeat(spaces);
        return text.split('\n').map(line => indent + line).join('\n');
    }
}
//# sourceMappingURL=prompt-builder.js.map