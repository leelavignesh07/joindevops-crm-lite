import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        poppins: ["var(--font-poppins)", "sans-serif"],
      },
      colors: {
        // JoinDevOps brand palette (see brandbook: Colors page)
        brand: {
          50: "#f1eeff",
          100: "#e4deff",
          200: "#c9bdff",
          300: "#a68dff",
          400: "#8a68ff",
          500: "#7249ff",
          600: "#6136ff", // primary — exact brandbook purple
          700: "#4f27e0",
          800: "#3f1fb3",
          900: "#331c8a",
        },
        ink: {
          50: "#f4f5f7",
          100: "#e5e7eb",
          400: "#4b5265",
          600: "#232838",
          900: "#080e1c", // exact brandbook navy/ink
        },
        sky: "#3198ff", // brandbook secondary blue
        aqua: "#46ddea", // brandbook accent cyan
      },
    },
  },
  plugins: [],
};

export default config;
