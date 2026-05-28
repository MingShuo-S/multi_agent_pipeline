// src/cli.ts - 命令行入口
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import os from 'os';
import { PipelineRunner } from './runtime/pipeline-runner.js';
import { initializeWorkspace } from './install.js';
const getWorkspaceRoot = () => {
    return path.join(os.homedir(), '.openclaw', 'workspaces', 'multi-agent-pipeline');
};
yargs(hideBin(process.argv))
    .command('init', '初始化工作区', () => { }, async () => {
    console.log('初始化工作区...');
    await initializeWorkspace();
})
    .command('start <template>', '启动管道', (yargs) => {
    return yargs
        .positional('template', {
        describe: '管道模板名称',
        type: 'string',
    })
        .option('user', {
        describe: '用户 ID',
        type: 'string',
        demandOption: true,
    })
        .option('project', {
        describe: '项目 ID',
        type: 'string',
        demandOption: true,
    });
}, async (argv) => {
    const workspaceRoot = getWorkspaceRoot();
    const runner = new PipelineRunner(workspaceRoot, argv.user, argv.project, argv.template);
    await runner.run();
})
    .demandCommand()
    .help()
    .parse();
//# sourceMappingURL=cli.js.map