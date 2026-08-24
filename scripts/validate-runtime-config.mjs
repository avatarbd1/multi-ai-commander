import { loadRuntimeConfigFromEnv } from '../dist/config/runtime-config.js';

try {
  const config = loadRuntimeConfigFromEnv();
  console.log(
    `RUNTIME_CONFIG_VALID planner=${config.planner.name} builder=${config.builder.name} reviewer=${config.reviewer.name}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'RUNTIME_CONFIG_INVALID');
  process.exitCode = 1;
}
