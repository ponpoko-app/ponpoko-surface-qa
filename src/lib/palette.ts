function luminance(hex: string): number {
  return [1, 3, 5].reduce((sum, offset, index) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const linear = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function applyPalette(tokens: Record<string, string>, root: HTMLElement = document.documentElement): void {
  const rgba = (hex: string, alpha: number): string =>
    `rgba(${Number.parseInt(hex.slice(1, 3), 16)}, ${Number.parseInt(hex.slice(3, 5), 16)}, ${Number.parseInt(hex.slice(5, 7), 16)}, ${alpha})`;
  const base = tokens.base;
  const light = HEX.test(base ?? "") && luminance(base) > 0.4;
  const borderAlpha = light ? 0.18 : 0.06;
  const alpha: Record<string, number> = { border: borderAlpha, ring: 0.55, overlay: 0.45 };
  const allowed = [
    "base",
    "panel",
    "surface",
    "elevated",
    "fg",
    "fg_muted",
    "fg_subtle",
    "accent",
    "danger",
    "on_accent",
    "border",
    "ring",
    "overlay",
  ];
  for (const key of allowed) {
    const value = tokens[key];
    if (!HEX.test(value ?? "")) continue;
    root.style.setProperty(`--color-${key.replace(/_/g, "-")}`, alpha[key] === undefined ? value : rgba(value, alpha[key]));
  }
  if (HEX.test(tokens.accent ?? "")) root.style.setProperty("--color-accent-soft", rgba(tokens.accent, 0.12));
  root.style.colorScheme = light ? "light" : "dark";
  root.dataset.theme = light ? "light" : "dark";
}
