/**
 * Host theme sync (M1).
 *
 * DSH 官方主题机制：深色 = body[data-ds-dark-theme]（见 tokens.css 双层令牌）。
 * 本模块不维护开关，仅跟随宿主：MutationObserver 监听 body 属性变化，
 * 对外暴露 subscribe(getSnapshot) 微型 store。观察器惰性启动：
 * 首个订阅者出现才挂载，最后一个订阅者退订即断开。
 */

export interface ThemeSnapshot {
  /** 宿主当前是否处于深色主题（body 带 data-ds-dark-theme 属性）。 */
  dark: boolean;
}

const DARK_ATTR = 'data-ds-dark-theme';

let snapshot: ThemeSnapshot = { dark: false };
let observer: MutationObserver | undefined;
const listeners = new Set<() => void>();

function readDark(): boolean {
  try {
    return typeof document !== 'undefined' && document.body?.hasAttribute(DARK_ATTR) === true;
  } catch {
    return false;
  }
}

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[dsh-workflow] theme listener error:', error);
    }
  }
}

function ensureObserver(): void {
  if (observer !== undefined || typeof document === 'undefined' || document.body === null) return;
  observer = new MutationObserver(() => {
    const dark = readDark();
    if (dark !== snapshot.dark) {
      snapshot = { dark };
      emit();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTR] });
}

function maybeStopObserver(): void {
  if (listeners.size > 0) return;
  observer?.disconnect();
  observer = undefined;
}

/** 当前主题快照（引用稳定，值变化才换新对象）。 */
export function getThemeSnapshot(): ThemeSnapshot {
  return snapshot;
}

/** 便捷读取：当前是否深色。 */
export function isDarkTheme(): boolean {
  return snapshot.dark;
}

/**
 * 订阅主题变化；返回退订函数。
 * 订阅时会以当前快照对齐一次（观察器惰性启动，首订前可能错过变更）。
 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const dark = readDark();
  if (dark !== snapshot.dark) {
    snapshot = { dark };
  }
  ensureObserver();
  // 补发一次当前值，保证「订阅即一致」语义。
  try {
    listener();
  } catch (error) {
    console.error('[dsh-workflow] theme listener error:', error);
  }
  return () => {
    listeners.delete(listener);
    maybeStopObserver();
  };
}
