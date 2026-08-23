/**
 * 添加节点分类浮层（M2，§4.1 Dify block-selector 形态）。
 * 三分组（逻辑控制 / AI 能力 / 转换处理），项前类型色点，玻璃拟态浮层。
 * BLOCK_GROUPS 为纯数据导出，供单测与未来连线末端「+」复用。
 */
import React, { useEffect } from "react";
import type { NodeType } from "@dsh-workflow/schema";
import { NODE_GROUP_TITLES, type NodeGroup } from "./types.js";
import { GROUP_ORDER, listNodeDefinitions } from "./nodes/registry.js";
import styles from "./node-styles.module.css";

export interface BlockItem {
  type: NodeType;
  label: string;
  /** 类型识别色点（与节点色条同源）。 */
  dotColor: string;
}

export interface BlockGroup {
  key: NodeGroup;
  title: string;
  items: BlockItem[];
}

/** 由注册表派生的三分组静态数据（模块加载时构建一次）。 */
function buildGroups(): BlockGroup[] {
  return GROUP_ORDER.map((group) => ({
    key: group,
    title: NODE_GROUP_TITLES[group],
    items: listNodeDefinitions()
      .filter((def) => def.group === group)
      .map((def) => ({ type: def.type, label: def.label, dotColor: def.colorToken })),
  }));
}

export const BLOCK_GROUPS: readonly BlockGroup[] = buildGroups();

export interface BlockSelectorProps {
  /** 是否展开；false 渲染 null。 */
  open: boolean;
  onSelect(type: NodeType): void;
  onClose(): void;
  /** 定位锚点样式（默认画布左上工具栏下方）。 */
  style?: React.CSSProperties;
}

export function BlockSelector({ open, onSelect, onClose, style }: BlockSelectorProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={styles.selector}
      style={style}
      data-testid="studio-block-selector"
      role="menu"
    >
      {BLOCK_GROUPS.map((group) => (
        <React.Fragment key={group.key}>
          <div className={styles.groupTitle}>{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.type}
              type="button"
              role="menuitem"
              className={styles.item}
              data-testid={"block-item-" + item.type}
              onClick={() => {
                onSelect(item.type);
                onClose();
              }}
            >
              <span className={styles.dot} style={{ background: item.dotColor }} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export default BlockSelector;
