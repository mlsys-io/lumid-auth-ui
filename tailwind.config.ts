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
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        // Coral — flourish-only accent (the ✳); claude.ai restyle.
        coral: { DEFAULT: "var(--accent-coral)" },
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
        },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
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
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
