/** @type {import("tailwindcss").Config} */
export default {
  content: ["./src/calculator/**/*.{ts,tsx}"],
  prefix: "calc-",
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};