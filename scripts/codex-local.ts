// Codex on a local model, for trying the Codex backend without a ChatGPT
// plan. llama-server speaks the Responses API but not Codex's tool
// namespaces (a server's tools grouped under one name), so this proxy sits
// between them: it lists a namespace's tools as plain functions on the way
// in, and tags the model's calls with their namespace on the way back, so
// Codex routes them to the world server. With OpenAI's own models none of
// this is needed.
//
//   node scripts/codex-local.ts [port]            (LLAMA_URL, default http://127.0.0.1:8080)
//   HARNESS_DM=codex CODEX_PATH=$PWD/scripts/codex-local.sh pnpm start
import { createServer } from "node:http";

const UP = process.env.LLAMA_URL ?? "http://127.0.0.1:8080";
const port = Number(process.argv[2] ?? 8090);
const names = new Map<string, [string, string]>();

function flatten(tools: any[]): any[] {
  return tools.flatMap((t) => {
    if (t?.type === "function") return [t];
    if (t?.type !== "namespace") return [];
    return (t.tools ?? []).filter((f: any) => f?.type === "function").map((f: any) => {
      const flat = `${t.name}__${f.name}`;
      names.set(flat, [t.name, f.name]);
      return { ...f, name: flat };
    });
  });
}

function tag(node: any): any {
  if (Array.isArray(node)) node.forEach(tag);
  else if (node && typeof node === "object") {
    if (node.type === "function_call" && names.has(node.name)) [node.namespace, node.name] = names.get(node.name)!;
    Object.values(node).forEach(tag);
  }
  return node;
}

function line(l: string): string {
  if (!l.startsWith("data: {")) return l;
  try {
    return `data: ${JSON.stringify(tag(JSON.parse(l.slice(6))))}\n`;
  } catch {
    return l;
  }
}

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body = Buffer.concat(chunks).toString();
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j.tools)) body = JSON.stringify({ ...j, tools: flatten(j.tools) });
  } catch { /* not JSON: as it came */ }
  try {
    const up = await fetch(UP + req.url, {
      method: req.method, body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      headers: { "content-type": "application/json", accept: String(req.headers.accept ?? "*/*") },
    });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of up.body ?? []) {
      buf += dec.decode(chunk as Uint8Array, { stream: true });
      for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) res.write(line(buf.slice(0, i + 1)));
    }
    res.end(buf && line(buf));
  } catch (e) {
    res.writeHead(502, { "content-type": "text/plain" }).end(`the local model is not answering: ${(e as Error).message}\n`);
  }
}).listen(port, "127.0.0.1", () => console.log(`codex-local on http://127.0.0.1:${port}/v1 → ${UP}`));
