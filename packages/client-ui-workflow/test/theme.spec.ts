import { afterEach, describe, expect, it } from "vitest";
import { getThemeSnapshot, isDarkTheme, subscribeTheme } from "../src/theme.js";

describe("theme store", () => {
  afterEach(() => {
    document.body.removeAttribute("data-ds-dark-theme");
  });

  it("follows body[data-ds-dark-theme] attribute changes", async () => {
    expect(isDarkTheme()).toBe(false);
    const seen: boolean[] = [];
    const off = subscribeTheme(() => seen.push(getThemeSnapshot().dark));

    document.body.setAttribute("data-ds-dark-theme", "");
    // MutationObserver 回调走微任务队列。
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(getThemeSnapshot().dark).toBe(true);

    document.body.removeAttribute("data-ds-dark-theme");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain(true);
    off();
    expect(isDarkTheme()).toBe(false);
  });

  it("stops observing after the last subscriber unsubscribes", () => {
    const off1 = subscribeTheme(() => {});
    const off2 = subscribeTheme(() => {});
    off1();
    off2();
    // 再次订阅应恢复观察且立即对齐当前快照（订阅即一致语义）。
    let calls = 0;
    const off3 = subscribeTheme(() => {
      calls += 1;
    });
    expect(calls).toBe(1); // 补发一次当前值
    off3();
  });
});
