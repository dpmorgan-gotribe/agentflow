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
  .action((styleCount) => analyze(parseInt(styleCount) || 1));

program
  .command('flows')
  .option('--style <number>', 'Style to use (0, 1, 2, ...)', '0')
  .description('Create flow mockups')
  .action(flows);

program
  .command('mockups')
  .description('Create style mockups')
  .action(mockups);

program
  .command('stylesheet')
  .option('--style <number>', 'Style to use (0, 1, 2, ...)', '1')
  .option('--force', 'Write output even if validation fails')
  .description('Create design system')
  .action(stylesheet);

program
  .command('screens')
  .option('--limit <number>', 'Limit number of screens to generate')
  .description('Create all screen designs')
  .action(screens);

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
