declare module 'openclaw/plugin-sdk/plugin-entry' {
  export type OpenClawPluginToolContext = {
    agentId?: string;
    sessionId?: string;
    userId?: string;
    projectId?: string;
    [key: string]: unknown;
  };

  export type OpenClawPluginApi = {
    registerTool: (tool: any, opts?: any) => void;
  };

  export function definePluginEntry<T>(entry: T): T;
}
