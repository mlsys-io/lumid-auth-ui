import animate from "tailwindcss-animate";
import palette from "./src/styles/palette.json";

// Token colours are stored as RGB CHANNELS (--x-rgb: 250 247 241) so Tailwind 3
// can apply opacity modifiers. A bare var(--hex) makes `bg-background/85`,
// `ring-ring/40`, `border-border/50` generate NO CSS at all — that silently
// killed the sticky header's background and every primitive's focus ring
// (which then fell back to Tailwind's default blue). See globals.css :root.
const ch = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Serif display face — wordmark, greetings, page titles ONLY.
        display: ['"Source Serif 4 Variable"', "Georgia", "ui-serif", "serif"],
      },
      colors: {
        border: ch("border"),
        input: "var(--input)",
        ring: ch("ring"),
        background: ch("background"),
        foreground: ch("foreground"),
        primary: { DEFAULT: ch("primary"), foreground: ch("primary-foreground") },
        secondary: { DEFAULT: ch("secondary"), foreground: ch("secondary-foreground") },
        destructive: { DEFAULT: ch("destructive"), foreground: ch("destructive-foreground") },
        muted: { DEFAULT: ch("muted"), foreground: ch("muted-foreground") },
        accent: { DEFAULT: ch("accent"), foreground: ch("accent-foreground") },
        // Lumen scales — src/styles/palette.json is the source of truth (and
        // scripts/check-contrast.mjs asserts the text pairings). ink replaces
        // slate/gray/zinc in Studio; ember = attention, brick = failing,
        // lagoon = running/info, plum = knowledge. ok/succeeded stays gold.
        ink: palette.ink,
        ember: palette.ember,
        brick: palette.brick,
        lagoon: palette.lagoon,
        plum: palette.plum,
        // Categorical chart series, validated order: chart-1 … chart-8.
        chart: Object.fromEntries(palette.chart.map((c: string, i: number) => [String(i + 1), c])),
        // Coral — flourish-only accent (the ✳); claude.ai restyle.
        coral: { DEFAULT: ch("accent-coral") },
        // Gold — the brand spiral's metallic antique gold/bronze. Deliberately
        // DESATURATED + DARK (vs Tailwind amber, which reads orange). This is
        // the Studio accent: active states, action buttons, brand flourishes.
        gold: { ...palette.gold, DEFAULT: palette.gold["600"] },
        // Sidebar tokens were defined in globals.css but never mapped
        // (the @theme inline block is Tailwind-4 syntax — inert here).
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        popover: { DEFAULT: ch("popover"), foreground: ch("popover-foreground") },
        card: { DEFAULT: ch("card"), foreground: ch("card-foreground") },
        // Re-mapped to indigo so ported Runmesh + Lumilake pages'
        // bg-brand-* / text-brand-* / shadow-brand-* classes resolve
        // to our purple/indigo brand instead of silently dropping
        // (which left buttons like "Recharge" invisible against the
        // dark card). Swap to sky if you want Runmesh's original
        // sky-blue; indigo aligns with lum.id's sidebar accent.
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        dark: {
          800: "#1e293b",
          900: "#0f172a",
        },
        // Lumilake brand blue — the ported tree uses bare `bg-blue`,
        // `text-blue`, `border-blue`, `text-blue-0`. The original
        // Lumilake frontend never defined these tokens either, so
        // buttons like JobDetail's Download (`bg-blue text-white`)
        // rendered as white-on-white. Include `DEFAULT` + `0` for the
        // brand, and re-state the standard Tailwind blue scale (50–900)
        // so neighbouring code (admin/, lqt/, AIAssistantModal, …)
        // that uses `bg-blue-100`, `text-blue-800` etc. still resolves
        // — `extend.colors.blue` replaces, not merges with, defaults.
        blue: {
          DEFAULT: "#1e3a8a",
          0: "#1e3a8a",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
      },
      borderRadius: {
        // --radius is 0.75rem app-wide and 0.625rem under html[data-surface=studio]
        // (globals.css), so Studio gets 6/8/10 while ported trees keep 8/10/12.
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Lumen type scale. Names deliberately avoid Tailwind's own (xs/sm/…) so
      // ported trees are untouched. cn() registers them with tailwind-merge
      // (src/lib/utils.ts) — without that, `text-body text-ink-700` loses the size.
      fontSize: {
        nano: ["10px", { lineHeight: "14px" }],
        micro: ["11px", { lineHeight: "16px" }],
        caption: ["12px", { lineHeight: "16px" }],
        meta: ["13px", { lineHeight: "20px" }],
        body: ["14px", { lineHeight: "22px" }],
        read: ["15px", { lineHeight: "25px" }],
        title: ["17px", { lineHeight: "26px", letterSpacing: "-0.005em" }],
        h3: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
        h2: ["24px", { lineHeight: "32px", letterSpacing: "-0.015em" }],
        h1: ["32px", { lineHeight: "40px", letterSpacing: "-0.02em" }],
      },
      // Warm-tinted elevation (ink-900 = 34 28 19), never neutral black.
      boxShadow: {
        e1: "0 1px 0 0 rgb(34 28 19 / 0.03), 0 1px 2px -1px rgb(34 28 19 / 0.06)",
        e2: "0 4px 12px -2px rgb(34 28 19 / 0.08), 0 2px 4px -2px rgb(34 28 19 / 0.06)",
        e3: "0 24px 48px -12px rgb(34 28 19 / 0.18), 0 8px 16px -8px rgb(34 28 19 / 0.08)",
      },
      // Motion tokens — match src/components/chat/motion.tsx (ENTER/COLLAPSE).
      transitionTimingFunction: {
        lumen: "cubic-bezier(0.22, 1, 0.36, 1)",
        "lumen-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: { 120: "120ms", 180: "180ms", 240: "240ms", 400: "400ms" },
      keyframes: {
        "lumen-rise": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "lumen-shimmer": { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        "lumen-breathe": { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.45", transform: "scale(0.82)" } },
        "lumen-roll": { from: { opacity: "0", transform: "translateY(60%)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "lumen-rise": "lumen-rise 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "lumen-shimmer": "lumen-shimmer 1.6s linear infinite",
        "lumen-breathe": "lumen-breathe 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "lumen-roll": "lumen-roll 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  // tailwindcss-animate: makes the shadcn primitives' data-[state] animate-in /
  // fade-in / zoom-in classes real. They were dead CSS until 2026-11 — every
  // dialog, popover and menu snapped open with no transition.
  plugins: [animate],
};
