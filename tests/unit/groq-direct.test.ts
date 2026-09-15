// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auth from "../../src/auth";

vi.mock("../../src/auth", () => ({ getSession: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: {
    supabaseUrl: "",
    supabaseAnon: "",
    parseFunction: "https://test.supabase.co/functions/v1/parse"
  },
  STORAGE_KEYS: { llmKey: "marginalia.llmKey", provider: "marginalia.provider" }
}));

import { parsePhrase, polishPhrase, parseJsonLenient } from "../../src/supabase";

function groqOk(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}
function groqFail(message: string, failed_generation = "") {
  return {
    ok: false,
    status: 400,
    json: async () => ({ error: { message, failed_generation, type: "invalid_request_error" } })
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("marginalia.provider", "groq");
  localStorage.setItem("marginalia.llmKey", "test-key");
  (auth.getSession as any).mockResolvedValue(null);
  vi.clearAllMocks();
});

describe("groq direct path — strict json_schema", () => {
  it("parsePhrase sends strict json_schema (not json_object) with temperature", async () => {
    (globalThis.fetch as any) = vi.fn().mockResolvedValue(
      groqOk(JSON.stringify({ title: "Call mom", datetime: null, type: "todo", reminder: null }))
    );
    // "tomorrow" is an EXPLICIT cue so applyResolve leaves the LLM result alone.
    const out = await parsePhrase("call mom tomorrow");
    expect(out.title).toBe("Call mom");
    expect(out.kind).toBe("todo");
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.temperature).toBe(0.2);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toContain("title");
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it("parsePhrase retries once after a 400 failed_generation then succeeds", async () => {
    (globalThis.fetch as any) = vi.fn()
      .mockResolvedValueOnce(groqFail("Failed to generate JSON. Please adjust your prompt.", "{bad"))
      .mockResolvedValueOnce(
        groqOk(JSON.stringify({ title: "Call mom", datetime: null, type: "todo", reminder: null }))
      );
    const out = await parsePhrase("call mom tomorrow");
    expect(out.title).toBe("Call mom");
    expect((fetch as any).mock.calls.length).toBe(2);
  });

  it("parsePhrase falls back to lenient json_object after two strict failures", async () => {
    const calls: any[] = [];
    (globalThis.fetch as any) = vi.fn().mockImplementation(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      if (calls.length < 3) return groqFail("Failed to generate JSON. Please adjust your prompt.", "{bad");
      return groqOk(JSON.stringify({ title: "Call mom", datetime: null, type: "todo", reminder: null }));
    });
    const out = await parsePhrase("call mom tomorrow");
    expect(out.title).toBe("Call mom");
    expect(calls.length).toBe(3);
    expect(calls[0].response_format.type).toBe("json_schema");
    expect(calls[1].response_format.type).toBe("json_schema");
    expect(calls[2].response_format.type).toBe("json_object");
  });

  it("parsePhrase surfaces the groq detail after all retries fail", async () => {
    (globalThis.fetch as any) = vi.fn().mockResolvedValue(
      groqFail("Failed to generate JSON. Please adjust your prompt.", "{bad-gen}")
    );
    await expect(parsePhrase("call mom tomorrow")).rejects.toThrow(/Failed to generate JSON/);
    expect((fetch as any).mock.calls.length).toBe(3);
  });

  it("polishPhrase sends the items schema and normalizes drafts", async () => {
    (globalThis.fetch as any) = vi.fn().mockResolvedValue(
      groqOk(JSON.stringify({ items: [{ title: "Call mom", kind: "todo", datetime: null, reminder: null }] }))
    );
    const out = await polishPhrase("call mom tomorrow");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].title).toBe("Call mom");
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("schedule_polish");
  });
});

describe("parseJsonLenient", () => {
  it("strips ```json fences", () => {
    expect(parseJsonLenient('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws a clear groq error on invalid JSON", () => {
    expect(() => parseJsonLenient("not json")).toThrow(/groq error: invalid JSON/);
  });
});
