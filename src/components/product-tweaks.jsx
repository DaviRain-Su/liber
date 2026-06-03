import React from "react";
import {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRadio,
  TweakColor,
  TweakToggle,
  TweakSlider,
  TweakButton,
} from "./tweaks-panel.jsx";

/* product-tweaks.jsx — Tweaks island: reader layout variants + visual knobs. */
const READER_LAYOUT_OPTIONS = [
  { value: "classic", label: "经典" },
  { value: "folio", label: "书页" },
  { value: "archive", label: "批注" },
  { value: "vertical", label: "竖排" },
  { value: "immersive", label: "沉浸" },
];
const READER_LAYOUT_VALUES = new Set(READER_LAYOUT_OPTIONS.map((item) => item.value));

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  readerLayout: "classic",
  accent: "#c0432b",
  displayFont: "cormorant",
  dark: false,
  grain: 1,
  device: "desktop",
} /*EDITMODE-END*/;

function initialTweaks() {
  const next = { ...TWEAK_DEFAULTS };
  try {
    const layout = localStorage.getItem("liber.reader.layout");
    if (READER_LAYOUT_VALUES.has(layout)) next.readerLayout = layout;
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") next.dark = true;
  } catch {
    /* keep defaults */
  }
  return next;
}

function LiberTweaks() {
  const defaults = React.useMemo(initialTweaks, []);
  const [t, setTweak] = useTweaks(defaults);
  const readerLayoutRef = React.useRef(defaults.readerLayout);

  React.useEffect(() => {
    readerLayoutRef.current = t.readerLayout;
  }, [t.readerLayout]);

  /* device preview wiring */
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent("liber-device", { detail: t.device || "desktop" }));
  }, [t.device]);
  React.useEffect(() => {
    const r = () => setTweak("device", "desktop");
    window.addEventListener("liber-device-reset", r);
    return () => window.removeEventListener("liber-device-reset", r);
  }, []);

  /* apply on mount + change */
  React.useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.accent]);
  React.useEffect(() => {
    document.documentElement.setAttribute("data-display", t.displayFont);
  }, [t.displayFont]);
  React.useEffect(() => {
    document.documentElement.style.setProperty("--grain", t.grain);
  }, [t.grain]);
  React.useEffect(() => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (t.dark !== isDark) window.dispatchEvent(new Event("liber-toggle-theme"));
  }, [t.dark]);
  React.useEffect(() => {
    const layout = READER_LAYOUT_VALUES.has(t.readerLayout) ? t.readerLayout : "classic";
    localStorage.setItem("liber.reader.layout", layout);
    window.dispatchEvent(new CustomEvent("liber-reader-layout", { detail: layout }));
  }, [t.readerLayout]);
  React.useEffect(() => {
    const syncLayout = (event) => {
      const layout = READER_LAYOUT_VALUES.has(event.detail) ? event.detail : "classic";
      if (layout !== readerLayoutRef.current) setTweak("readerLayout", layout);
    };
    window.addEventListener("liber-reader-layout", syncLayout);
    return () => window.removeEventListener("liber-reader-layout", syncLayout);
  }, [setTweak]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="设备预览" />
      <TweakRadio
        label="视口"
        value={t.device || "desktop"}
        options={[
          { value: "desktop", label: "桌面" },
          { value: "phone", label: "手机" },
        ]}
        onChange={(v) => setTweak("device", v)}
      />
      <div style={{ fontSize: 11, color: "#8a7d68", padding: "2px 12px 8px", lineHeight: 1.5 }}>
        选「手机」在 iPhone 边框里预览移动端版——底部标签栏、折叠顶栏、全屏阅读器都会随之切换。
      </div>

      <TweakSection label="阅读器布局" />
      <TweakRadio
        label="布局"
        value={t.readerLayout}
        options={READER_LAYOUT_OPTIONS}
        onChange={(v) => setTweak("readerLayout", v)}
      />
      <div style={{ fontSize: 11, color: "#8a7d68", padding: "2px 12px 8px", lineHeight: 1.5 }}>
        经典 = 居中正文；书页 = 仿纸页；批注 = 常驻右栏；竖排 = 中文竖排；沉浸 =
        极简自动隐藏。打开任意一本书阅读查看。
      </div>

      <TweakSection label="视觉" />
      <TweakColor
        label="主色 · 朱砂"
        value={t.accent}
        options={["#c0432b", "#9a5b2e", "#2e7d57", "#3a4fb0", "#7a3d6b"]}
        onChange={(v) => setTweak("accent", v)}
      />
      <TweakRadio
        label="标题字体"
        value={t.displayFont}
        options={[
          { value: "cormorant", label: "经典" },
          { value: "playfair", label: "华丽" },
          { value: "spectral", label: "现代" },
        ]}
        onChange={(v) => setTweak("displayFont", v)}
      />
      <TweakToggle label="夜间模式" value={t.dark} onChange={(v) => setTweak("dark", v)} />
      <TweakSlider
        label="纸张颗粒"
        value={t.grain}
        min={0}
        max={2}
        step={0.1}
        onChange={(v) => setTweak("grain", v)}
      />

      <TweakSection label="流程" />
      <TweakButton
        label="重看引导 / 登录"
        onClick={() => window.dispatchEvent(new Event("liber-show-onboarding"))}
      />
    </TweaksPanel>
  );
}

export { LiberTweaks, TWEAK_DEFAULTS };
