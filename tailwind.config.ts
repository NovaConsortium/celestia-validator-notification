import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: "hsl(var(--success))",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Neue Haas Grotesk Display Pro",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        display: [
          "var(--font-sans)",
          "Neue Haas Grotesk Display Pro",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
      },
      letterSpacing: {
        editorial: "-0.025em",
        micro: "0.16em",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        hairline: "inset 0 0 0 1px hsl(var(--foreground) / 0.08)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.4), 0 8px 32px -8px hsl(var(--primary) / 0.35)",
      },
      transitionTimingFunction: {
        editorial: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        "out-quint": "cubic-bezier(0.22, 1, 0.36, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translate3d(0, 8px, 0)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-up-lg": {
          from: { opacity: "0", transform: "translate3d(0, 14px, 0)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-down": {
          from: { opacity: "0", transform: "translate3d(0, -6px, 0)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-right": {
          from: { opacity: "0", transform: "translate3d(-8px, 0, 0)" },
          to: { opacity: "1", transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "none" },
        },
        pop: {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        shake: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "20%, 60%": { transform: "translate3d(-3px, 0, 0)" },
          "40%, 80%": { transform: "translate3d(3px, 0, 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up": "fade-up 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up-lg": "fade-up-lg 560ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-down": "fade-down 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-right": "fade-right 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        pop: "pop 360ms cubic-bezier(0.22, 1, 0.36, 1)",
        shake: "shake 380ms cubic-bezier(0.36, 0.07, 0.19, 0.97)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
