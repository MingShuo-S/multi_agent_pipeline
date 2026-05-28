// OpenClaw Plugin Entry Point
// This file re-exports from dist/index.js so that relative module paths resolve correctly
// when OpenClaw loads plugins from the root directory.

export { default } from './dist/index.js';
export * from './dist/index.js';
