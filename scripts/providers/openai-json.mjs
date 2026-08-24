#!/usr/bin/env node

export async function readStdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw new Error('PROVIDER_INPUT_REQUIRED');
  return JSON.parse(raw);
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  const parts = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n');
}

export async function callOpenAIStructured({ name, schema, instructions, input }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_REQUIRED');
  const model = process.env.OPENAI_MODEL || 'gpt-5.6';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions,
      input: JSON.stringify(input),
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OPENAI_API_FAILED:${response.status}`);
  const payload = await response.json();
  if (payload.status && payload.status !== 'completed') throw new Error(`OPENAI_RESPONSE_${String(payload.status).toUpperCase()}`);
  const text = extractOutputText(payload);
  if (!text.trim()) throw new Error('OPENAI_OUTPUT_MISSING');
  return JSON.parse(text);
}
