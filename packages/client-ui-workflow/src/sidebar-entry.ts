/**
 * Sidebar entry injection for Workflow Studio.
 * 
 * Injects a "工作流" (Workflow) navigation button in the DSH sidebar shell,
 * matching the established pattern from dsh-task-board.
 */
import css from "./workflow-studio.module.css";

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

export function mountSidebarEntry(onToggle: () => void): () => void {
  if (typeof document !== 'undefined' && document.querySelector(WORKFLOW_ENTRY_SELECTOR) !== null) {
    return () => {};
  }

  const entry = document.createElement('button');
  entry.type = 'button';
  entry.dataset.dshWorkflowEntry = '';
  entry.className = css.entry;
  entry.setAttribute('aria-label', '工作流工作台 (Workflow Studio)');
  entry.innerHTML = `<span class="${css.entryIcon}">${ICON}</span><span class="${css.entryLabel}">工作流工作台</span>`;
  entry.addEventListener('click', onToggle);

  let root: HTMLElement | undefined;
  let placed = false;

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect();
      root = undefined;
      placed = false;
    }
    if (placed) {
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

  const waitObserver = new MutationObserver(() => { tryPlace(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });

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

  tryPlace();

  return () => {
    waitObserver.disconnect();
    rootObserver.disconnect();
    entry.remove();
  };
}
