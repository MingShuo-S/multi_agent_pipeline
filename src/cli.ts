// src/cli.ts - 命令行入口

import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PipelineRunner } from './runtime/pipeline-runner.js';
import { initializeWorkspace } from './install.js';
import { WORKSPACE_ROOT } from './config.js';

export function main(): void {
  yargs(hideBin(process.argv))
    .command(
      'init',
      '初始化工作区',
      () => {},
      async () => {
        console.log('初始化工作区...');
        await initializeWorkspace();
      }
    )
    .command(
      'start <template>',
      '启动管道',
      (yargs: any) => {
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
      },
      async (argv: any) => {
        const runner = new PipelineRunner(
          WORKSPACE_ROOT,
          argv.user as string,
          argv.project as string,
          argv.template as string
        );
        await runner.run();
      }
    )
    .demandCommand()
    .help()
    .parse();
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || process.argv[1] === __filename.replace(/\.ts$/, '.js'))) {
  main();
}
