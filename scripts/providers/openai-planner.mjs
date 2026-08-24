#!/usr/bin/env node
import { callOpenAIStructured, readStdinJson } from './openai-json.mjs';

const schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    targetRepository: { type: 'string' },
    baseBranch: { type: 'string' },
    objective: { type: 'string' },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          requirement: { type: 'string' },
          evidenceRequired: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'requirement', 'evidenceRequired'],
        additionalProperties: false,
      },
    },
    constraints: { type: 'array', items: { type: 'string' } },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    productionMutationAllowed: { type: 'boolean' },
  },
  required: ['id','title','targetRepository','baseBranch','objective','acceptanceCriteria','constraints','riskLevel','productionMutationAllowed'],
  additionalProperties: false,
};

try {
  const input = await readStdinJson();
  const output = await callOpenAIStructured({
    name: 'commander_task_contract',
    schema,
    instructions: [
      'You are Commander's planning role. Convert exactly one owner command into one bounded engineering TaskContract.',
      'Do not invent business requirements. Preserve the supplied target when present. Use only supported target aliases or exact repositories described in the input.',
      'Acceptance criteria must be concrete and independently verifiable. Keep productionMutationAllowed false unless the input explicitly contains a separate human authorization channel; this front door does not.',
      'Follow the operating constitution supplied in the input. Output only the schema.',
    ].join(' '),
    input,
  });
  process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'PLANNER_FAILED'}\n`);
  process.exitCode = 1;
}
