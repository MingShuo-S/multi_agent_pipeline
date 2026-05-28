import { ToolContext, Template } from '../types.js';
/**
 * pipeline_read - 读取 Slot 的内容
 */
export declare function pipelineRead(context: ToolContext, slotName: string, template: Template): Promise<string | object>;
/**
 * pipeline_write_slot - 写入 Slot 的内容
 */
export declare function pipelineWriteSlot(context: ToolContext, slotName: string, content: string | object, template: Template): Promise<void>;
/**
 * pipeline_add_remark - 添加评论
 */
export declare function pipelineAddRemark(context: ToolContext, content: string): Promise<void>;
/**
 * 为工具导出标准的 OpenClaw 工具定义
 */
export declare const pipelineTools: {
    pipeline_read: {
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
};
//# sourceMappingURL=pipeline.d.ts.map