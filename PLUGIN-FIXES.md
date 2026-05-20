# Plugin Fixes Documentation

This document outlines the two critical plugin issues that have been fixed.

## Issue 1: Plugin Registration Error

### Problem
When loading the plugin in OpenClaw, the following error occurred:
```
21:46:44 [plugins] multi-agent-pipeline missing register/activate export
```

### Root Cause
The plugin was missing the required lifecycle hooks that OpenClaw expects from plugins. OpenClaw looks for `register` and `activate` functions to be explicitly exported from the plugin entry point.

### Solution
Added explicit `register` and `activate` export functions in `src/index.ts`:

```typescript
let pluginConfig: Record<string, any> = {};

export function register(context: any): void {
  pluginConfig = context?.config || {};
  console.log('[multi-agent-pipeline] Plugin registered with context:', context?.config?.id);
}

export function activate(context: any): void {
  pluginConfig = context?.config || {};
  console.log('[multi-agent-pipeline] Plugin activated with context:', context?.config?.id);
}
```

These functions:
- Are automatically called by OpenClaw during plugin lifecycle
- Capture the plugin configuration for later use
- Enable proper plugin initialization and activation

**Status**: ✅ FIXED

---

## Issue 2: Template Path Resolution

### Problem
When an agent called pipeline tools, the error showed:
```
Error: Failed to read template 'xiaohongshu-creation': 
Error: ENOENT: no such file or directory, open '/root/.openclaw/workspace/orchestrator/templates/xiaohongshu-creation.json'
```

The path `/root/.openclaw/workspace/orchestrator` is OpenClaw's internal orchestrator workspace, NOT the correct pipeline workspace which should be `~/.openclaw/workspaces/multi-agent-pipeline`.

### Root Cause
The workspace root path resolution lacked proper configuration support and fallback chains. When an agent running in OpenClaw's environment called pipeline tools, the tools would resolve to an incorrect workspace directory if environment variables weren't set correctly.

### Solution
Implemented a robust 4-level fallback chain for workspace root resolution in `src/index.ts`:

```typescript
function getWorkspaceRoot(): string {
  // Priority 1: Plugin configuration (from openclaw.plugin.json)
  if (pluginConfig?.workspaceRoot) {
    return pluginConfig.workspaceRoot;
  }
  
  // Priority 2: Explicit environment variable
  if (process.env.PIPELINE_WORKSPACE_ROOT) {
    return process.env.PIPELINE_WORKSPACE_ROOT;
  }
  
  // Priority 3: OpenClaw home directory
  if (process.env.OPENCLAW_HOME) {
    return `${process.env.OPENCLAW_HOME}/workspaces/multi-agent-pipeline`;
  }
  
  // Priority 4: Standard ~/.openclaw/workspaces/multi-agent-pipeline
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  return `${home}/.openclaw/workspaces/multi-agent-pipeline`;
}
```

Also updated `openclaw.plugin.json` to support workspace configuration:

```json
{
  "configSchema": {
    "type": "object",
    "properties": {
      "workspaceRoot": {
        "type": "string",
        "description": "Pipeline workspace root directory",
        "default": ""
      }
    }
  }
}
```

### How It Works

1. **Plugin Configuration Level**: When the plugin is configured in OpenClaw with a `workspaceRoot` setting, that takes the highest priority
2. **Environment Variable Level**: If `PIPELINE_WORKSPACE_ROOT` is explicitly set in the environment, it uses that
3. **OpenClaw Home Level**: If `OPENCLAW_HOME` is set, it constructs the workspace path as `{OPENCLAW_HOME}/workspaces/multi-agent-pipeline`
4. **Standard Default**: Falls back to `~/.openclaw/workspaces/multi-agent-pipeline` (or `/root/.openclaw/workspaces/multi-agent-pipeline` if `HOME` is not set)

This ensures that:
- Agents running in OpenClaw can find the correct workspace
- The workspace configuration can be customized via plugin settings
- Environment variables can override defaults
- There's always a sensible fallback

**Status**: ✅ FIXED

---

## Configuration Instructions

### For OpenClaw Administrators

To properly configure the plugin, you have several options:

#### Option 1: Use Plugin Configuration (Recommended)
In your OpenClaw configuration, set:
```json
{
  "plugins": {
    "multi-agent-pipeline": {
      "workspaceRoot": "/path/to/your/workspace"
    }
  }
}
```

#### Option 2: Use Environment Variables
Set the environment variable before starting OpenClaw:
```bash
export OPENCLAW_HOME=/path/to/openclaw
# or
export PIPELINE_WORKSPACE_ROOT=/path/to/workspace
```

#### Option 3: Use Default Path
If no configuration is provided, the plugin will use the standard OpenClaw workspace structure:
```
~/.openclaw/workspaces/multi-agent-pipeline/
├── templates/          # Template definitions (JSON files)
├── projects/           # User project states
└── agent-guides/       # Agent collaboration guides
```

### For Developers

When testing the plugin locally:

```bash
# Set the workspace root before running
export OPENCLAW_HOME=$HOME/.openclaw
# Then start the plugin/OpenClaw
```

---

## Testing the Fixes

### Test 1: Plugin Registration
```bash
# Should see in logs:
# [multi-agent-pipeline] Plugin registered with context: multi-agent-pipeline
# [multi-agent-pipeline] Plugin activated with context: multi-agent-pipeline
```

### Test 2: Template Resolution
```bash
# Call a pipeline tool (e.g., from an agent):
# Should properly read templates from:
# ~/.openclaw/workspaces/multi-agent-pipeline/templates/
```

### Troubleshooting

If you still see template path errors:

1. **Check workspace directory exists**:
   ```bash
   ls -la ~/.openclaw/workspaces/multi-agent-pipeline/templates/
   ```

2. **Check environment variables**:
   ```bash
   echo $OPENCLAW_HOME
   echo $PIPELINE_WORKSPACE_ROOT
   echo $HOME
   ```

3. **Check plugin configuration**: Verify the `workspaceRoot` setting in your OpenClaw configuration

4. **Enable debug logging**: The plugin logs its configuration when it registers and activates

---

## Files Changed

1. **src/index.ts**
   - Added `register()` and `activate()` lifecycle functions
   - Improved `getWorkspaceRoot()` with 4-level fallback chain
   - Added plugin config support for workspace customization

2. **openclaw.plugin.json**
   - Added `workspaceRoot` configuration option in `configSchema`
   - Allows administrators to configure workspace location

3. **dist/index.js** (Auto-generated)
   - Compiled output reflecting all changes

---

## Compatibility

- **OpenClaw Version**: 2026.5.12+ (tested with 2026.5.18 plugin API)
- **Node.js**: 18+
- **Module Type**: ES Module

---

## Summary

Both issues have been resolved:
1. ✅ Plugin now properly exports `register` and `activate` functions
2. ✅ Workspace paths are resolved correctly with proper fallback chain and configuration support

The plugin can now be successfully loaded by OpenClaw and correctly resolve template paths regardless of the runtime environment.
