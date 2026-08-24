/**
 * Sidebar entry injection for Workflow Studio (M1 rework).
 *
 * 注入与自愈逻辑保留 task-board 先例的精华（双层 MutationObserver：
 * body 级等待 + 根级复位重插，同帧补插无闪烁）；可见性改由 PresetGate
 * 驱动：shouldShow=true 才挂载入口，false 即卸载（§2.2 行为规格）。
 * 入口为纯 DOM 按钮，不进入宿主 React 协调树。
 */
import css from "./workflow-studio.module.css";
import "./styles/tokens.css";

export const WORKFLOW_ENTRY_SELECTOR = "[data-dsh-workflow-entry]";

const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="2.2"/>
  <circle cx="4" cy="4" r="2.2"/>
  <circle cx="12" cy="4" r="2.2"/>
  <path d="M4 6.2v4.8M6.2 4h3.6M6.2 12h3.6"/>
</svg>`;

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return undefined;
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined);
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of Array.from(root.children)) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement;
  }
  return undefined;
}

function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root);
  if (button === undefined) return false;
  if (entry.parentElement !== root) {
    // 锚定相对「插件家族块」（task-board / ssh / workflow 的兄弟注入）而非
    // 瞬态 logoRow 几何：家族内任一插件自愈重插都落在相同相对次序，不会互换。
    const row = button.closest('[class*="logoRow"]');
    const base = (row !== null && row.parentElement === root) ? row : button;
    const siblingEntries = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-workflow-entry]')
    );
    const anchor = siblingEntries.length > 0 ? siblingEntries[siblingEntries.length - 1].nextElementSibling : base.nextElementSibling;
    root.insertBefore(entry, anchor);
  }
  return true;
}

export interface SidebarEntryController {
  /** 门控联动：shouldShow 变化时挂载/卸载入口。 */
  setVisible: (visible: boolean) => void;
  /** 同步激活高亮。 */
  setActive: (active: boolean) => void;
  dispose: () => void;
}

/**
 * 创建侧边栏入口控制器。初始隐藏，等门控给出 shouldShow 再挂载。
 */
export function createSidebarEntry(onToggle: () => void): SidebarEntryController {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.dataset.dshWorkflowEntry = '';
  entry.className = css.entry;
  entry.setAttribute('aria-label', '工作流 (Workflow Studio)');
  entry.innerHTML = `<span class="${css.entryIcon}">${ICON}</span><span class="${css.entryLabel}">工作流</span>`;
  entry.addEventListener('click', onToggle);

  let root: HTMLElement | undefined;
  let placed = false;
  // 常驻侧边栏入口（对齐 task-board 与 ssh 先例），用户随时可点击展开/收起工作台
  let visible = true;

  const tryPlace = (): void => {
    if (!visible) return;
    if (root !== undefined && !root.isConnected) {
      // 宿主重建了整个侧边栏 pane：根级观察器随旧树失效，断开并从头再查。
      rootObserver.disconnect();
      root = undefined;
      placed = false;
    }
    if (placed) {
      // 廉价短路：入口仍挂在文档里则不做任何事。
      if (document.body.contains(entry)) return;
      rootObserver.disconnect();
      root = undefined;
      placed = false;
    }
    root ??= sidebarRoot();
    if (root === undefined) return;
    placed = placeEntry(root, entry);
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true });
    }
  };

  // 第一层：body 级等待/整列重建兜底（放置后保留观察；已放置场景只付一次
  // contains 检查的成本，避免聊天流式渲染反复触发全量重查）。
  const waitObserver = new MutationObserver(() => { tryPlace(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });

  // 第二层：根级自愈 —— React 重渲染挤掉按钮时同帧重插。
  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false;
      tryPlace();
      return;
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry);
    }
  });

  const unmountEntry = (): void => {
    entry.remove();
    placed = false;
  };

  return {
    setVisible(next): void {
      try {
        visible = next;
        if (next) tryPlace();
        else unmountEntry();
      } catch (error) {
        console.error('[dsh-workflow] sidebar entry visibility sync failed:', error);
      }
    },
    setActive(active): void {
      // 注意：赋 undefined 会物化成 data-active="undefined" 造成常亮，
      // 必须用 delete 移除属性（对齐 task-board 先例注释）。
      if (active) entry.dataset.active = 'true';
      else delete entry.dataset.active;
    },
    dispose(): void {
      waitObserver.disconnect();
      rootObserver.disconnect();
      entry.remove();
    },
  };
}
