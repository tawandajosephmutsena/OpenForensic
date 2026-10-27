import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F5FAF8",
        ink: "#153A3B",
        brand: { teal: "#087E78", orange: "#E66A30" },
        muted: "#5D7472",
      },
      fontFamily: {
        sans: ["Inter", "Arial", "Helvetica", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 3px rgba(15,82,77,.035), 0 8px 24px rgba(15,82,77,.06)",
      },
    },
  },
  plugins: [],
};

export default config;
