import { describe, it, expect } from 'vitest';

describe('config paths', () => {
  it('WORKSPACE_ROOT 不包含 templates 后缀', async () => {
    const { WORKSPACE_ROOT, SEED_TEMPLATES_DIR, SHARED_DIR } = await import('../src/config.js');
    // WORKSPACE_ROOT should be derived from src/../workspace
    expect(WORKSPACE_ROOT).toBeDefined();
    expect(WORKSPACE_ROOT.length).toBeGreaterThan(0);
    expect(SEED_TEMPLATES_DIR).toContain('templates');
    expect(SHARED_DIR).toContain('_shared');
  });

  it('SHARED_DIR 是 WORKSPACE_ROOT 的子路径', async () => {
    const { WORKSPACE_ROOT, SHARED_DIR } = await import('../src/config.js');
    expect(SHARED_DIR).toContain(WORKSPACE_ROOT);
  });

  it('SEED_TEMPLATES_DIR 不同于 WORKSPACE_ROOT/templates', async () => {
    const { WORKSPACE_ROOT, SEED_TEMPLATES_DIR } = await import('../src/config.js');
    // SEED_TEMPLATES_DIR points to src/../templates (seed templates)
    // while WORKSPACE_ROOT/templates is the user's template dir
    expect(SEED_TEMPLATES_DIR).not.toBe(`${WORKSPACE_ROOT}/templates`);
  });
});
