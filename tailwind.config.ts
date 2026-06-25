import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0a0c",
          surface: "#101013",
          "surface-2": "#16161a",
          "surface-3": "#1d1d22",
        },
        border: {
          DEFAULT: "#26262c",
          subtle: "#1a1a1f",
          strong: "#3a3a42",
        },
        fg: {
          DEFAULT: "#ededf0",
          muted: "#a0a0aa",
          subtle: "#6e6e78",
        },
        accent: {
          DEFAULT: "#e8365d",
          hover: "#f04a70",
          subtle: "#3a1620",
        },
        status: {
          online: "#34d399",
          offline: "#71717a",
          warning: "#fbbf24",
          error: "#ef4444",
        },
      },
      fontFamily: {
        display: ["Syne", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "12px",
      },
    },
  },
  plugins: [],
} satisfies Config;
