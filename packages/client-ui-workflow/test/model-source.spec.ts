import { describe, it, expect } from "vitest";
import { parseModelCatalog, probeModelCatalog, resolveModelDisplay } from "../src/nodes/shared/model-source.js";

describe("§10.1 模型数据源探测降级", () => {
  it("无法探测时降级为 unavailable（空目录）", () => {
    expect(probeModelCatalog({})).toEqual({ available: false, models: [], source: "unavailable" });
    expect(probeModelCatalog(null)).toMatchObject({ available: false });
    expect(probeModelCatalog(undefined)).toMatchObject({ available: false });
  });

  it("识别 { models: [...] } 包装形态", () => {
    const host = { __DSH_MODEL_SELECTION__: { models: [{ id: "deepseek-chat", label: "DeepSeek-V3" }, { id: "gpt-4o" }] } };
    const snap = probeModelCatalog(host);
    expect(snap.available).toBe(true);
    expect(snap.source).toBe("dsh-client-ui-model-selection");
    expect(snap.models).toEqual([
      { id: "deepseek-chat", label: "DeepSeek-V3" },
      { id: "gpt-4o", label: "gpt-4o" },
    ]);
  });

  it("识别 getSnapshot store 形态并容忍 getter 抛错", () => {
    const ok = probeModelCatalog({ "dsh-client-ui-model-selection": { getSnapshot: () => ({ list: [{ id: "m1" }] }) } });
    expect(ok.available).toBe(true);
    expect(ok.models[0]).toEqual({ id: "m1", label: "m1" });

    const boom = probeModelCatalog({ __DSH_MODEL_SELECTION__: { getSnapshot: () => { throw new Error("boom"); } } });
    expect(boom.available).toBe(false);
  });

  it("parseModelCatalog 对畸形输入安全回落", () => {
    expect(parseModelCatalog(42).available).toBe(false);
    expect(parseModelCatalog(["not-an-object", null, 1]).models).toEqual([]);
    expect(parseModelCatalog([{ nope: true }, { id: 3 }]).available).toBe(false);
  });

  it("resolveModelDisplay 三级回落：节点模型 > 会话模型 > 占位", () => {
    expect(resolveModelDisplay("deepseek-r1", undefined)).toBe("deepseek-r1");
    expect(resolveModelDisplay(undefined, "session-model")).toBe("session-model");
    expect(resolveModelDisplay("", undefined)).toBe("(跟随会话)");
    expect(resolveModelDisplay(null, null)).toBe("(跟随会话)");
  });
});
