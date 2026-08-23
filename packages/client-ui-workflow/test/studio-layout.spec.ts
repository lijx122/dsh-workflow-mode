import { describe, expect, it } from "vitest";
import {
  CANVAS_MIN,
  clampCenterBasis,
  clampPanelWidth,
  computeInitialCenterBasis,
  LAYOUT_STORAGE_KEY,
  loadLayoutMemory,
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_MIN,
  resolveInitialLayout,
  saveLayoutMemory,
  SPLITTER_WIDTH,
} from "../src/studio-layout.js";

function memoryStorage(initial?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => map.set(k, String(v)),
  } as Storage;
}

describe("computeInitialCenterBasis (§10.5 formula)", () => {
  it("uses min(original×2, viewport budget) and floors at 480", () => {
    // 原列 400 → ×2=800；视口 1920 → 预算 1920−420−6−320=1174 → 取 800。
    expect(computeInitialCenterBasis(400, 1920)).toBe(800);
    // 原列 700 → ×2=1400；预算 1174 → 取预算。
    expect(computeInitialCenterBasis(700, 1920)).toBe(1174);
    // 极小视口：预算为负 → 保底 480。
    expect(computeInitialCenterBasis(500, 800)).toBe(CANVAS_MIN);
  });
});

describe("clamp functions (§10.6 unified clamps)", () => {
  it("clamps panel width into 380–600 and respects narrow viewports", () => {
    expect(clampPanelWidth(200)).toBe(PANEL_MIN);
    expect(clampPanelWidth(9999)).toBe(PANEL_MAX);
    expect(clampPanelWidth(NaN)).toBe(PANEL_DEFAULT);
    expect(clampPanelWidth(-5)).toBe(PANEL_MIN);
    // 窄视口：面板让位画布最小宽，但自身仍保底 380。
    expect(clampPanelWidth(600, 900)).toBe(Math.min(PANEL_MAX, Math.max(PANEL_MIN, 900 - SPLITTER_WIDTH - CANVAS_MIN)));
    expect(clampPanelWidth(600, 600)).toBe(PANEL_MIN);
  });

  it("re-clamps stored centerBasis against the current viewport (§10.10)", () => {
    expect(clampCenterBasis(1200, 1920)).toBe(1200); // ≤ 视口−6−380
    expect(clampCenterBasis(5000, 1600)).toBe(1600 - SPLITTER_WIDTH - PANEL_MIN);
    expect(clampCenterBasis(Number.NaN, 1600)).toBe(CANVAS_MIN);
    expect(clampCenterBasis(100, 1000)).toBe(CANVAS_MIN); // 永远 ≥ 480
  });
});

describe("layout memory v2 (§10.10 storage contract)", () => {
  it("persists and reloads layout with re-clamping applied at resolve time", () => {
    const store = memoryStorage();
    saveLayoutMemory({ centerBasis: 960, panelWidth: 520 }, store);
    const loaded = loadLayoutMemory(store);
    expect(loaded).toEqual({ centerBasis: 960, panelWidth: 520 });

    // 记忆超出当前视口时按视口重 clamp。
    const resolved = resolveInitialLayout({
      originalColumnWidth: 300,
      viewportWidth: 1280,
      stored: loadLayoutMemory(memoryStorage({ [LAYOUT_STORAGE_KEY]: JSON.stringify({ centerBasis: 4000, panelWidth: 2000 }) })),
    });
    expect(resolved.centerBasis).toBe(1280 - SPLITTER_WIDTH - PANEL_MIN);
    expect(resolved.panelWidth).toBeLessThanOrEqual(PANEL_MAX);
  });

  it("falls back silently on bad values / write failures (try/catch)", () => {
    expect(loadLayoutMemory(memoryStorage({ [LAYOUT_STORAGE_KEY]: "{not json" }))).toEqual({});
    expect(loadLayoutMemory(memoryStorage({ [LAYOUT_STORAGE_KEY]: JSON.stringify({ centerBasis: "x", panelWidth: null }) }))).toEqual({});
    expect(loadLayoutMemory(undefined)).toEqual({});

    const throwing = memoryStorage();
    Object.defineProperty(throwing, "setItem", { value: () => { throw new Error("quota"); } });
    expect(() => saveLayoutMemory({ panelWidth: 420 }, throwing)).not.toThrow();
  });

  it("resolveInitialLayout without stored values applies the formula + default panel", () => {
    const resolved = resolveInitialLayout({ originalColumnWidth: 380, viewportWidth: 1920 });
    expect(resolved.centerBasis).toBe(computeInitialCenterBasis(380, 1920));
    expect(resolved.panelWidth).toBe(clampPanelWidth(PANEL_DEFAULT));
  });
});
