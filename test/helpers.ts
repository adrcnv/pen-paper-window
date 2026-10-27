// Rows as Claude Code's stream-json writes them: a tool call in an assistant
// row, its result in a user row.
let n = 0;
export function toolRows(tool: string, input: object, result: object): unknown[] {
  const id = `toolu_${++n}`;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name: `mcp__harness-dm__${tool}`, input }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }] } },
  ];
}
export const textRow = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
export const resultRow = (extra: object = {}) => ({ type: "result", subtype: "success", is_error: false, session_id: "sess-1", result: "", ...extra });
