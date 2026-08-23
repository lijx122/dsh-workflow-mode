/**
 * Studio layout math (M1, §2.1 / §10 P1-5 / P1-6 / P1-10).
 *
 * 纯函数 + 可注入存储，便于在 jsdom 单测中直接验证公式与夹紧：
 * - 初始画布宽（§10.5）：max(480px, min(原列×2, 可视区宽 − 420 − 6 − 320))；
 * - 统一钳制（§10.6）：属性面板 380–600px；画布视口最小 480px；
 * - 布局记忆（§10.10）：键 dsh.workflowStudio.layout.v2，读取后按当前视口
 *   重 clamp 再应用，写入 try/catch 静默降级。
 */

/** 属性面板宽度下限（§10.6）。 */
export const PANEL_MIN = 380;
/** 属性面板宽度上限（§10.6）。 */
export const PANEL_MAX = 600;
/** 属性面板默认宽度（§2.1 右侧面板 420px）。 */
export const PANEL_DEFAULT = 420;
/** 分隔条宽度。 */
export const SPLITTER_WIDTH = 6;
/** 画布视口最小宽度（§10.6）。 */
export const CANVAS_MIN = 480;
/** 布局记忆 localStorage 键（§10.10 升级到 v2）。 */
export const LAYOUT_STORAGE_KEY = 'dsh.workflowStudio.layout.v2';

/** §2.1 三栏示意中的固定预留量：右面板默认 420 + 分隔条 6 + 余量 320。 */
const PANEL_RESERVE_TOTAL = 420 + SPLITTER_WIDTH + 320;

/** v2 布局记忆形状。 */
export interface StoredLayout {
  centerBasis?: number;
  panelWidth?: number;
}

export interface ResolvedLayout {
  centerBasis: number;
  panelWidth: number;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * §10.5 初始画布宽度公式：
 * max(480, min(原列×2, 可视区宽 − 420 − 6 − 320))
 */
export function computeInitialCenterBasis(
  originalColumnWidth: number,
  viewportWidth: number,
): number {
  const doubled = finiteNumber(originalColumnWidth * 2) ?? CANVAS_MIN;
  const budget = finiteNumber(viewportWidth - PANEL_RESERVE_TOTAL) ?? CANVAS_MIN;
  return Math.max(CANVAS_MIN, Math.min(doubled, budget));
}

/** 已存 centerBasis 的视口重夹紧：保底 CANVAS_MIN，封顶可视区减去面板下限与分隔条。 */
export function clampCenterBasis(centerBasis: number, viewportWidth: number): number {
  const value = finiteNumber(centerBasis) ?? CANVAS_MIN;
  const upper = Math.max(CANVAS_MIN, viewportWidth - SPLITTER_WIDTH - PANEL_MIN);
  return Math.max(CANVAS_MIN, Math.min(value, upper));
}

/**
 * 属性面板宽度钳制（§10.6 面板 380–600），并按当前视口收缩以尽量保住
 * 「画布视口 ≥ 480」：极端窄视口下两个下限不可兼得时，面板仍保底 380。
 */
export function clampPanelWidth(panelWidth: number, viewportWidth: number = Number.POSITIVE_INFINITY): number {
  const requested = finiteNumber(panelWidth) ?? PANEL_DEFAULT;
  const hardMax = Math.min(PANEL_MAX, Math.max(PANEL_MIN, viewportWidth - SPLITTER_WIDTH - CANVAS_MIN));
  const capped = Math.min(requested, hardMax);
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, capped));
}

/**
 * 打开时的初始布局解析（§10.5 + §10.10 重 clamp）：
 * 有合法记忆则按当前视口重夹紧后采用，否则走公式/默认值。
 */
export function resolveInitialLayout(input: {
  originalColumnWidth: number;
  viewportWidth: number;
  stored?: StoredLayout | undefined;
}): ResolvedLayout {
  const storedBasis = finiteNumber(input.stored?.centerBasis);
  const storedPanel = finiteNumber(input.stored?.panelWidth);
  const centerBasis =
    storedBasis !== undefined
      ? clampCenterBasis(storedBasis, input.viewportWidth)
      : computeInitialCenterBasis(input.originalColumnWidth, input.viewportWidth);
  const panelWidth =
    storedPanel !== undefined
      ? clampPanelWidth(storedPanel, input.viewportWidth)
      : clampPanelWidth(PANEL_DEFAULT, input.viewportWidth);
  return { centerBasis, panelWidth };
}

function storage(): Storage | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

/** 读取布局记忆；坏值/异常一律返回 {}（§10.11 同款容错风格）。 */
export function loadLayoutMemory(store: Storage | undefined = storage()): StoredLayout {
  try {
    const raw = store?.getItem(LAYOUT_STORAGE_KEY);
    if (typeof raw !== 'string' || raw.length === 0) return {};
    const parsed = JSON.parse(raw) as StoredLayout | null | undefined;
    if (parsed === null || typeof parsed !== 'object') return {};
    return {
      centerBasis: finiteNumber(parsed.centerBasis),
      panelWidth: finiteNumber(parsed.panelWidth),
    };
  } catch {
    return {};
  }
}

/** 写入布局记忆；try/catch 静默降级（隐私模式/配额溢出等）。 */
export function saveLayoutMemory(layout: StoredLayout, store: Storage | undefined = storage()): void {
  try {
    store?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* 静默降级：布局记忆属于增强功能，失败不影响可用性 */
  }
}
