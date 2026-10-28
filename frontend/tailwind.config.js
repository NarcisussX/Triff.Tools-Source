// tailwind.config.js
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      boxShadow: {
        card: "0 8px 30px rgba(0,0,0,0.25)",
      },
      colors: {
        background: "#0b1220",
      },
    },
  },
  plugins: [],
};
