import { describe, it, expect } from "vitest";
import { BLOCK_GROUPS } from "../src/block-selector.js";
import { NODE_GROUP_TITLES } from "../src/types.js";

describe("block-selector 三分组数据（§4.2）", () => {
  it("恰好三组且标题正确", () => {
    expect(BLOCK_GROUPS.map((g) => g.key)).toEqual(["logic", "ai", "transform"]);
    expect(BLOCK_GROUPS.map((g) => g.title)).toEqual([
      NODE_GROUP_TITLES.logic,
      NODE_GROUP_TITLES.ai,
      NODE_GROUP_TITLES.transform,
    ]);
  });

  it("12 类全覆盖、无重复、每项都有色点", () => {
    const all = BLOCK_GROUPS.flatMap((g) => g.items);
    const types = all.map((i) => i.type);
    expect(new Set(types).size).toBe(12);
    for (const item of all) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.dotColor.length).toBeGreaterThan(0);
    }
  });

  it("分组归位：逻辑控制 7 / AI 能力 3 / 转换处理 2", () => {
    const byKey = new Map(BLOCK_GROUPS.map((g) => [g.key, g.items.map((i) => i.type)]));
    expect(byKey.get("logic")).toEqual(
      expect.arrayContaining(["start", "end", "if_else", "switch", "merge", "set_variable", "iteration"]),
    );
    expect(byKey.get("ai")).toEqual(expect.arrayContaining(["llm", "subagent", "human"]));
    expect(byKey.get("transform")).toEqual(expect.arrayContaining(["template", "code"]));
    expect(byKey.get("logic")).toHaveLength(7);
    expect(byKey.get("ai")).toHaveLength(3);
    expect(byKey.get("transform")).toHaveLength(2);
  });
});
