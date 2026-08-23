/**
 * 自绘缩放胶囊（M2，§10.13）：替代 React Flow 原生 Controls。
 * −/百分比/＋ 与适应画布四钮，玻璃胶囊样式走 node-styles.module.css。
 */
import React from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import styles from "../node-styles.module.css";

export function ZoomCapsule(): React.ReactElement {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const percent = Math.round(zoom * 100);

  return (
    <div className={styles.zoomCapsule} data-testid="studio-zoom-capsule">
      <button type="button" className={styles.zoomBtn} title="缩小" aria-label="缩小" onClick={() => void zoomOut()}>−</button>
      <span className={styles.zoomText}>{percent}%</span>
      <button type="button" className={styles.zoomBtn} title="放大" aria-label="放大" onClick={() => void zoomIn()}>+</button>
      <button type="button" className={styles.zoomBtn} title="适应画布" aria-label="适应画布" onClick={() => void fitView({ duration: 300 })}>⤓</button>
    </div>
  );
}
