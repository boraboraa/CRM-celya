import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          DEFAULT: "#0A0E1A",
          800: "#0F1522",
          700: "#141B2B",
          600: "#1B2436",
          500: "#243047",
        },
        celya: {
          cyan: "#22D3EE",
          blue: "#4F7BFF",
          violet: "#A855F7",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "sans-serif"],
      },
      backgroundImage: {
        "celya-gradient":
          "linear-gradient(100deg, #22D3EE 0%, #4F7BFF 52%, #A855F7 100%)",
      },
      boxShadow: {
        glow: "0 0 40px -12px rgba(79,123,255,0.55)",
        lift: "0 10px 28px -14px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
