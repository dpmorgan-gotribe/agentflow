#!/usr/bin/env node
import { Command } from 'commander';
import { init } from './commands/init.js';
import { analyze } from './commands/analyze.js';
import { flows } from './commands/flows.js';
import { mockups } from './commands/mockups.js';
import { stylesheet } from './commands/stylesheet.js';
import { screens } from './commands/screens.js';
import { planFix } from './commands/plan-fix.js';
import { planFeature } from './commands/plan-feature.js';
import { userflows } from './commands/userflows.js';

const program = new Command();

program
  .name('agentflow')
  .description('Agentic design pipeline')
  .version('2.0.0');

program
  .command('init <name>')
  .description('Create a new project')
  .option('--no-git', 'Skip git repository initialization')
  .action((name, options) => init(name, { noGit: options.git === false }));

program
  .command('analyze [styleCount]')
  .description('Analyze wireframes, research competitors, generate styles')
  .option('--verify', 'Show detailed coverage report')
  .option('--useAssets', 'All styles use user assets (variations of user vision)')
  .action((styleCount, options) => analyze(parseInt(styleCount) || 1, { verify: options.verify, useAssets: options.useAssets }));

program
  .command('flows')
  .option('--style <number>', 'Style to use (0, 1, 2, ...)', '0')
  .option('--platform <name>', 'Target platform (webapp, backend, ...)')
  .description('Create flow mockups')
  .action((options) => flows({ style: options.style, platform: options.platform }));

program
  .command('mockups')
  .description('Create style mockups')
  .action(() => mockups());

program
  .command('stylesheet')
  .option('--style <number>', 'Style to use (0, 1, 2, ...)', '1')
  .option('--platform <name>', 'Target platform (webapp, backend, ...)')
  .option('--skill <type>', 'Layout skill to use (webapp, mobile, desktop)')
  .option('--force', 'Write output even if validation fails')
  .description('Create design system')
  .action((options) => stylesheet({ style: options.style, platform: options.platform, skill: options.skill, force: options.force }));

program
  .command('screens')
  .option('--limit <number>', 'Limit number of screens to generate')
  .option('--platform <name>', 'Target platform (webapp, backend, ...)')
  .option('--skill <type>', 'Layout skill to use (webapp, mobile, desktop)')
  .option('--force', 'Regenerate all screens (ignore existing valid screens)')
  .option('--batch <number>', 'Batch size for parallel generation')
  .description('Create all screen designs')
  .action((options) => screens({
    limit: options.limit,
    platform: options.platform,
    skill: options.skill,
    force: options.force,
    batch: options.batch
  }));

program
  .command('userflows')
  .option('--platform <name>', 'Filter to specific platform')
  .description('Generate visual userflows diagram with navigation zones')
  .action((options) => userflows({ platform: options.platform }));

program
  .command('plan-fix <name>')
  .option('--context <text>', 'Additional context for the bug')
  .description('Create a bug fix plan')
  .action(planFix);

program
  .command('plan-feature <name>')
  .option('--context <text>', 'Additional context for the feature')
  .description('Create a feature plan')
  .action(planFeature);

program.parse();
