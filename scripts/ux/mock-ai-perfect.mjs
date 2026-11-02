// Faux OpenRouter « parfait » : exécute exactement l'action demandée (meilleur cas pour la version de référence).
import http from "node:http";
let calls = 0;
const send = (res, o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
http.createServer((req, res) => {
  if (req.method === "GET") { res.end(String(calls)); return; }
  if (req.url === "/reset") { calls = 0; res.end("0"); return; }
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    calls++;
    const j = JSON.parse(b || "{}");
    const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const msg = (content, stop_reason) => send(res, { id: "m" + calls, type: "message", role: "assistant", model: j.model, content, stop_reason, stop_sequence: null, usage });
    const last = j.messages.at(-1);
    if (Array.isArray(last.content) && last.content.some((x) => x.type === "tool_result")) return msg([{ type: "text", text: "C'est fait." }], "end_turn");
    const blocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
    const ctx = blocks[0].text, text = blocks.at(-1).text;
    const board = JSON.parse(ctx.slice(ctx.indexOf("{")));
    const byName = (n) => board.items.find((i) => i.name === n);
    if (/Assigne-moi/.test(text)) {
      const t = board.items.find((i) => i.status === "block");
      return msg([{ type: "tool_use", id: "tu" + calls, name: "update_item", input: { item_id: t.id, owner: "Zaki", status: "doing" } }], "tool_use");
    }
    const m = text.match(/Confie « (.+?) » à (\S+)/);
    if (m) return msg([{ type: "tool_use", id: "tu" + calls, name: "update_item", input: { item_id: byName(m[1]).id, owner: m[2] } }], "tool_use");
    return msg([{ type: "text", text: "Voici mon analyse et deux options : vous pouvez reprendre la tâche, ou la confier à quelqu'un d'autre. Dites-moi laquelle appliquer." }], "end_turn");
  });
}).listen(4557);
