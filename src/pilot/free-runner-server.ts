import http from "node:http";

const port = Number(process.env.PORT ?? 10000);
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON_OBJECT");
  return parsed as Record<string, unknown>;
}

async function callFreeModel(command: string): Promise<{ model?: string; text: string }> {
  if (!openRouterKey) throw new Error("OPENROUTER_API_KEY_MISSING");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openRouterKey}`,
      "content-type": "application/json",
      "x-title": "Relife Free AI Feasibility Pilot",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        {
          role: "system",
          content:
            "You are in a feasibility test. Return a concise engineering response to the user's harmless task. Do not claim to have edited GitHub, deployed code, or executed tools.",
        },
        { role: "user", content: command },
      ],
      temperature: 0.1,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENROUTER_${response.status}:${raw.slice(0, 500)}`);

  const payload = JSON.parse(raw) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OPENROUTER_EMPTY_RESPONSE");
  return { model: payload.model, text };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      mode: "feasibility-only",
      freeModel: "openrouter/free",
      aiConfigured: Boolean(openRouterKey),
      githubWritesEnabled: false,
      autoMergeEnabled: false,
      deployEnabled: false,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/command") {
    try {
      const body = await readJson(req);
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!command || command.length > 4_000) {
        sendJson(res, 400, { ok: false, error: "COMMAND_REQUIRED_OR_TOO_LONG" });
        return;
      }
      const result = await callFreeModel(command);
      sendJson(res, 200, { ok: true, provider: "openrouter", route: "openrouter/free", ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      sendJson(res, 502, { ok: false, error: message.slice(0, 700) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`free-ai-feasibility listening on ${port}`);
});
