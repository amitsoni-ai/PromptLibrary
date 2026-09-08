import type { Config } from "tailwindcss";

// Design tokens mirror src/part_head.html :root (light) and
// :root[data-theme="dark"] / prefers-color-scheme (dark). Colours are wired to
// CSS variables (defined in src/app/globals.css) so light+dark parity and the
// legacy `data-theme` toggle both work with a single class set.
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-hover": "var(--surface-hover)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        "accent-soft": "var(--accent-soft)",
        "accent-on": "var(--accent-text-on)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        "good-blue": "var(--good-blue)",
        "good-blue-soft": "var(--good-blue-soft)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        DEFAULT: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      spacing: {
        sidebar: "var(--sidebar-w)",
      },
    },
  },
  plugins: [],
};

export default config;
