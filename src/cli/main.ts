#!/usr/bin/env node
import { runCli } from './run.js';
import { runPlanCli } from './plan.js';

declare const process: {
  argv: string[];
  exitCode?: number;
};

/**
 * The `commander` executable's single entry point, dispatching to the
 * `plan` and `run` subcommands. Each subcommand keeps its own standalone
 * main() (guarded so it only fires when that file is executed directly)
 * for direct invocation and for the existing tests that import runCli /
 * runPlanCli straight from their own modules -- this dispatcher does not
 * change either subcommand's behavior, it only routes argv[0] to it.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  if (subcommand === 'plan') {
    const { exitCode, result } = await runPlanCli(argv);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = exitCode;
    return;
  }

  if (subcommand === 'run') {
    const { exitCode, result } = await runCli(argv);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = exitCode;
    return;
  }

  console.error('Usage: commander <plan|run> ...');
  process.exitCode = 2;
}

void main();
