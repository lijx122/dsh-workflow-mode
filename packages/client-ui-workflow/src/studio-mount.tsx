/**
 * Studio View Mounting
 * 
 * Takes over the center column when active, mounting the React Workflow Studio root.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkflowStudio } from './WorkflowStudio.js';
import css from './workflow-studio.module.css';

export const WORKFLOW_VIEW_SELECTOR = '[data-dsh-workflow-view]';
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
const ACTIVE_ATTR = 'data-dsh-workflow-active';
const ACTIVATE_EVENT = 'dsh-panel-activate';
const PANEL_NAME = 'workflow';

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined;
}

let isStudioOpen = false;
let updateActiveState: (() => void) | undefined;

export function toggleWorkflowStudio(): void {
  isStudioOpen = !isStudioOpen;
  updateActiveState?.();
}

export function closeWorkflowStudio(): void {
  if (isStudioOpen) {
    isStudioOpen = false;
    updateActiveState?.();
  }
}

export function mountStudio(): () => void {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  const ensure = (): void => {
    if (container !== undefined) return;
    const column = conversationColumn();
    if (column === undefined) return;
    container = document.createElement('div');
    container.dataset.dshWorkflowView = '';
    container.className = css.studio;
    column.appendChild(container);
    root = createRoot(container);
    root.render(<WorkflowStudio onClose={closeWorkflowStudio} />);
  };

  const waitObserver = new MutationObserver(() => { ensure(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });

  const applyActive = (): void => {
    const entryEl = document.querySelector('[data-dsh-workflow-entry]');
    if (isStudioOpen) {
      document.documentElement.removeAttribute('data-dsh-taskboard-active');
      document.documentElement.removeAttribute('data-dsh-ssh-active');
      document.documentElement.setAttribute(ACTIVE_ATTR, '');
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
      if (entryEl) (entryEl as HTMLElement).dataset.active = 'true';
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR);
      if (entryEl) delete (entryEl as HTMLElement).dataset.active;
    }
  };
  updateActiveState = applyActive;

  const onOtherActivate = (event: Event): void => {
    if ((event as CustomEvent).detail !== PANEL_NAME && isStudioOpen) {
      closeWorkflowStudio();
    }
  };

  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!isStudioOpen) return;
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) {
      closeWorkflowStudio();
    }
  };

  document.addEventListener('click', onClickSidebarRow, true);
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  applyActive();
  ensure();

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true);
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    waitObserver.disconnect();
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    updateActiveState = undefined;
  };
}
