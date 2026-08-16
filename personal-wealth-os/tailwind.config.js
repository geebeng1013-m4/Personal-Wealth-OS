/** @type {import("tailwindcss").Config} */
export default {
  content: ["./src/calculator/**/*.{ts,tsx}"],
  prefix: "calc-",
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
    },
  },
  plugins: [],
};