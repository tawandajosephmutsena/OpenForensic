import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F7F6",
        ink: "#242422",
        bronze: "#9A6C45",
        muted: "#777770",
      },
      fontFamily: {
        sans: ["Inter", "Arial", "Helvetica", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 3px rgba(18,18,18,.025), 0 8px 24px rgba(18,18,18,.035)",
      },
    },
  },
  plugins: [],
};

export default config;
