/**
 * 自绘 MiniMap 玻璃卡（M2，§10.13）：替代 React Flow 原生 MiniMap。
 * 节点矩形按类型识别色渲染；视口框可点击/拖拽平移主画布。
 * 全部数据经 useStore 订阅，不触碰宿主 DOM。
 */
import React, { useCallback, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getNodeDefinition } from "../nodes/registry.js";
import styles from "../node-styles.module.css";

const PAD = 8;

function nodeColor(node: Node): string | undefined {
  const def = getNodeDefinition(String((node as { type?: unknown }).type ?? ""));
  return def?.colorToken;
}

export function StudioMiniMap(): React.ReactElement {
  const { setViewport, getViewport } = useReactFlow();
  const nodes = useStore((s) => s.nodes);
  const transform = useStore((s) => s.transform);
  const boxRef = useRef<HTMLDivElement>(null);

  // 内容包围盒（节点坐标系）。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = (n.measured?.width ?? n.width ?? 240) as number;
    const h = (n.measured?.height ?? n.height ?? 72) as number;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 1; maxY = 1;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const toScaleX = useCallback(
    (value: number, innerWidth: number) => PAD + ((value - minX) / spanX) * (innerWidth - PAD * 2),
    [minX, spanX],
  );
  const toScaleY = useCallback(
    (value: number, innerHeight: number) => PAD + ((value - minY) / spanY) * (innerHeight - PAD * 2),
    [minY, spanY],
  );

  // 视口框：把当前 transform 的可视区映射进小地图。
  const viewportBoxStyle = (): React.CSSProperties => {
    const el = boxRef.current;
    const innerWidth = el?.clientWidth ?? 148;
    const innerHeight = el?.clientHeight ?? 88;
    const container = el?.parentElement?.parentElement;
    const containerWidth = container?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 800);
    const containerHeight = container?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 600);
    const zoom = transform[2] || 1;
    const viewW = containerWidth / zoom / (spanX / (innerWidth - PAD * 2));
    const viewH = containerHeight / zoom / (spanY / (innerHeight - PAD * 2));
    const left = toScaleX(-transform[0] / zoom, innerWidth);
    const top = toScaleY(-transform[1] / zoom, innerHeight);
    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.min(innerWidth, Math.max(12, viewW)),
      height: Math.min(innerHeight, Math.max(10, viewH)),
    };
  };

  const moveViewportTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = boxRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      const innerWidth = rect.width;
      const innerHeight = rect.height;
      const container = el.parentElement?.parentElement;
      const containerWidth = container?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 800);
      const containerHeight = container?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 600);
      const zoom = transform[2] || 1;
      const graphX = minX + ((clientX - rect.left - PAD) / (innerWidth - PAD * 2)) * spanX;
      const graphY = minY + ((clientY - rect.top - PAD) / (innerHeight - PAD * 2)) * spanY;
      const next = getViewport();
      setViewport({
        x: -(graphX * zoom) + containerWidth / 2,
        y: -(graphY * zoom) + containerHeight / 2,
        zoom: next.zoom,
      });
    },
    [minX, minY, spanX, spanY, transform, setViewport, getViewport],
  );

  return (
    <div className={styles.minimapCard} data-testid="studio-minimap">
      <div
        ref={boxRef}
        className={styles.minimapCanvas}
        onPointerDown={(event) => {
          event.preventDefault();
          moveViewportTo(event.clientX, event.clientY);
          const onMove = (e: PointerEvent): void => moveViewportTo(e.clientX, e.clientY);
          const onUp = (): void => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      >
        {nodes.map((n) => {
          const w = (n.measured?.width ?? n.width ?? 240) as number;
          const h = (n.measured?.height ?? n.height ?? 72) as number;
          const color = nodeColor(n);
          return (
            <span
              key={n.id}
              className={styles.minimapNode}
              style={{
                left: toScaleX(n.position.x, boxRef.current?.clientWidth ?? 148),
                top: toScaleY(n.position.y, boxRef.current?.clientHeight ?? 88),
                width: Math.max(4, (w / spanX) * ((boxRef.current?.clientWidth ?? 148) - PAD * 2)),
                height: Math.max(3, (h / spanY) * ((boxRef.current?.clientHeight ?? 88) - PAD * 2)),
                ...(color !== undefined ? { background: color } : {}),
              }}
            />
          );
        })}
        <span className={styles.minimapViewport} style={viewportBoxStyle()} />
      </div>
    </div>
  );
}
