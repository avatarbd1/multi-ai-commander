#!/usr/bin/env node
import { callOpenAIStructured, readStdinJson } from './openai-json.mjs';

const schema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    provider: { type: 'string' },
    independentFromBuilder: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['info','low','medium','high','critical'] },
          category: { type: 'string', enum: ['requirements','bug','security','regression','test','architecture'] },
          message: { type: 'string' },
          evidence: { type: ['string','null'] },
          file: { type: ['string','null'] },
          line: { type: ['integer','null'] },
        },
        required: ['id','severity','category','message','evidence','file','line'],
        additionalProperties: false,
      },
    },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterionId: { type: 'string' },
          satisfied: { type: 'boolean' },
          evidence: { type: 'array', items: { type: 'string' } },
          notes: { type: ['string','null'] },
        },
        required: ['criterionId','satisfied','evidence','notes'],
        additionalProperties: false,
      },
    },
    recommendation: { type: 'string', enum: ['approve','changes_requested','blocked'] },
  },
  required: ['taskId','provider','independentFromBuilder','findings','requirements','recommendation'],
  additionalProperties: false,
};

try {
  const input = await readStdinJson();
  const provider = process.env.COMMANDER_PROVIDER_NAME || 'openai-reviewer';
  const output = await callOpenAIStructured({
    name: 'commander_review_report',
    schema,
    instructions: [
      'You are the independent reviewer for Commander. Review only the supplied exact remote PR diff, Builder evidence, CI evidence, task contract, and acceptance criteria.',
      'Do not assume Builder claims are true. Every acceptance criterion must have one requirements entry using the exact criterionId.',
      `Set provider exactly to ${JSON.stringify(provider)} and independentFromBuilder to true.`,
      'Recommend approve only when every criterion is satisfied and there is no material correctness, security, regression, test, or architecture blocker.',
      'Use changes_requested for repairable defects and blocked only for non-repairable/integrity/security situations. Output only the schema.',
    ].join(' '),
    input,
  });
  output.provider = provider;
  output.independentFromBuilder = true;
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'REVIEWER_FAILED'}\n`);
  process.exitCode = 1;
}
