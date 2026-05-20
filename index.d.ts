export declare function register(context: any): void;
export declare function activate(context: any): void;
export declare const tools: {
    pipeline_read: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            data: string | object;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                slot_name: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    pipeline_write_slot: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                slot_name: {
                    type: string;
                    description: string;
                };
                content: {
                    type: string[];
                    description: string;
                };
            };
            required: string[];
        };
    };
    pipeline_add_remark: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                content: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    style_get_profile: {
        handler: () => Promise<{
            success: boolean;
            data: {
                style?: string;
                avoid?: string[];
                feedback_log?: Array<{
                    project_id: string;
                    liked?: string;
                    disliked?: string;
                }>;
            };
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {};
        };
    };
    style_record_feedback: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                preference_updates: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    workspace_config: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            data: any;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                action: {
                    type: string;
                    enum: string[];
                    description: string;
                };
                template_name: {
                    type: string;
                    description: string;
                };
                agent_name: {
                    type: string;
                    description: string;
                };
                user_id: {
                    type: string;
                    description: string;
                };
                content: {
                    type: string[];
                    description: string;
                };
            };
            required: string[];
        };
    };
    agent_guide_generator: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                agent_name: {
                    type: string;
                    description: string;
                };
                instructions: {
                    type: string;
                    description: string;
                };
                append: {
                    type: string;
                    description: string;
                    default: boolean;
                };
            };
            required: string[];
        };
    };
    route_message: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            data: string;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                target_agent: {
                    type: string;
                    description: string;
                };
                message: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    pipeline_start: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            data: import("./tools/pipeline-start.js").CheckpointResult;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                template_name: {
                    type: string;
                    description: string;
                };
                user_id: {
                    type: string;
                    description: string;
                };
                project_id: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    pipeline_continue: {
        handler: (params: Record<string, any>) => Promise<{
            success: boolean;
            data: import("./tools/pipeline-continue.js").ContinueResult;
            error?: undefined;
        } | {
            success: boolean;
            error: string;
            data?: undefined;
        }>;
        id: string;
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                user_id: {
                    type: string;
                    description: string;
                };
                project_id: {
                    type: string;
                    description: string;
                };
                feedback: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
};
export { PipelineRunner } from './runtime/pipeline-runner.js';
export { StateManager } from './runtime/state-manager.js';
export { PromptBuilder } from './runtime/prompt-builder.js';
export { SkillRunner } from './runtime/skill-runner.js';
export { ToolAuth } from './tools/tool-auth.js';
export { MemoryManager } from './tools/memory.js';
export { WorkspaceConfigManager } from './tools/workspace-config.js';
export { AgentGuideGenerator } from './tools/agent-guide-generator.js';
export type { ToolContext, Template, PipelineState, PipelineStage } from './types.js';
//# sourceMappingURL=index.d.ts.map