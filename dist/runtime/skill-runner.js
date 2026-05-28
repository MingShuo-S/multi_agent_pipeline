// src/runtime/skill-runner.ts - 封装 OpenClaw Skill 调用
/**
 * SkillRunner 封装对 OpenClaw Skill 的调用
 *
 * 当前这是一个占位符实现。实际使用时需要：
 * 1. 集成 OpenClaw 的 runSkill() 或类似 API
 * 2. 将管道工具注入工具列表
 * 3. 将上下文（agent_name, user_id, project_id）注入
 * 4. 传入组装好的 prompt
 *
 * TODO: 实现完整的 OpenClaw 集成
 */
export class SkillRunner {
    static async run(config) {
        console.warn('[SkillRunner] 占位符实现 - 需要集成实际 OpenClaw API');
        // 模拟执行结果
        return {
            success: true,
            output: `[模拟执行] Agent ${config.agentName} 已运行`,
            stateUpdated: config.state,
        };
    }
    /**
     * 获取 Agent 的工具列表
     * TODO: 从 OpenClaw 读取 Agent 的 SKILL.md
     */
    static async getAgentTools(agentName) {
        // 占位符：返回空数组
        // 实际实现应该读取 ~/.openclaw/agents/{agentName}/SKILL.md
        return [];
    }
    /**
     * 构建最终的工具列表（原有工具 + 管道工具）
     */
    static buildToolList(agentTools, additionalTools = []) {
        const toolMap = new Map();
        // 添加 Agent 原有工具
        for (const tool of agentTools) {
            toolMap.set(tool.id, tool);
        }
        // 添加管道工具和额外工具
        for (const tool of additionalTools) {
            toolMap.set(tool.id, tool);
        }
        return Array.from(toolMap.values());
    }
}
//# sourceMappingURL=skill-runner.js.map