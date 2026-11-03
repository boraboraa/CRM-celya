import type { Config } from "tailwindcss";
// La requête du pointeur n'est écrite qu'une fois (lib/pointeur.ts).
import { REQUETE_SOURIS } from "./lib/pointeur";

const config: Config = {
  // Le survol n'existe qu'avec une souris : au doigt, un `hover:` restait
  // collé après le tap, et Safari demandait parfois deux taps (3/11).
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // `souris:` — les CIBLES compactes (case de 20 px, liens fins, croix)
      // n'existent qu'avec une souris. La mise en page, elle, reste à la
      // largeur (`lg:`). Un iPad en paysage : mise en page large, cibles de doigt.
      screens: {
        souris: { raw: REQUETE_SOURIS },
      },
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
        lift: "0 10px 28px -14px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
