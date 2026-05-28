import { Template, PipelineState } from '../types.js';
export interface SkillRunnerConfig {
    agentName: string;
    skillName?: string;
    userId: string;
    projectId: string;
    template: Template;
    state: PipelineState;
    additionalTools?: Array<{
        id: string;
        name: string;
    }>;
}
export interface SkillRunnerResult {
    success: boolean;
    output: string;
    stateUpdated: PipelineState;
}
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
export declare class SkillRunner {
    static run(config: SkillRunnerConfig): Promise<SkillRunnerResult>;
    /**
     * 获取 Agent 的工具列表
     * TODO: 从 OpenClaw 读取 Agent 的 SKILL.md
     */
    static getAgentTools(agentName: string): Promise<Array<{
        id: string;
        name: string;
    }>>;
    /**
     * 构建最终的工具列表（原有工具 + 管道工具）
     */
    static buildToolList(agentTools: Array<{
        id: string;
        name: string;
    }>, additionalTools?: Array<{
        id: string;
        name: string;
    }>): Array<{
        id: string;
        name: string;
    }>;
}
//# sourceMappingURL=skill-runner.d.ts.map