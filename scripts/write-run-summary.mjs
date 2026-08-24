import { readFile, appendFile } from 'node:fs/promises';

const [, , stage, resultPath, summaryPath] = process.argv;
if (!stage || !resultPath || !summaryPath || (stage !== 'plan' && stage !== 'run')) {
  console.error('Usage: node write-run-summary.mjs <plan|run> <result.json> <GITHUB_STEP_SUMMARY path>');
  process.exitCode = 2;
  process.exit();
}

const result = JSON.parse(await readFile(resultPath, 'utf8'));
const lines = [];

if (stage === 'plan') {
  lines.push('## Commander Plan');
  lines.push('');
  lines.push(`**Status:** ${result.status}`);
  if (result.status === 'PLANNED' && result.task) {
    lines.push(`- Task: \`${result.task.id}\` -- ${result.task.title}`);
    lines.push(`- Target: ${result.task.targetRepository}`);
    lines.push(`- Risk level: ${result.task.riskLevel}`);
  } else {
    lines.push(`- Blocker: ${result.error ?? 'unknown planning failure'}`);
  }
} else {
  lines.push('## Commander Run');
  lines.push('');
  lines.push(`**Status:** ${result.status}`);
  if (result.taskId) lines.push(`- Task: ${result.taskId}`);
  if (result.target) lines.push(`- Target: ${result.target}`);
  if (result.attempts !== undefined) lines.push(`- Builder attempts: ${result.attempts}`);

  if (result.status === 'HUMAN_GATE') {
    lines.push('');
    lines.push('Commander reached **HUMAN_GATE**. A human must review and decide whether to merge.');
    if (result.pullRequest) {
      lines.push(`- Pull request: ${result.pullRequest.url} (#${result.pullRequest.number})`);
      lines.push(`- Head SHA: \`${result.pullRequest.headSha}\``);
    }
    if (result.finalSha) lines.push(`- Final SHA: \`${result.finalSha}\``);
    if (result.verdict) lines.push(`- Verdict: ${result.verdict}`);
  } else {
    lines.push('');
    lines.push(`Commander stopped: **${result.status}**.`);
    if (result.lastFailure) lines.push(`- Blocker: ${result.lastFailure}`);
    if (result.error) lines.push(`- Error: ${result.error}`);
    if (Array.isArray(result.reasons) && result.reasons.length > 0) {
      lines.push(`- Reasons: ${result.reasons.join('; ')}`);
    }
  }

  lines.push('');
  lines.push('Commander never merges or deploys automatically. No further action was taken beyond this report.');
}

await appendFile(summaryPath, `${lines.join('\n')}\n`);
