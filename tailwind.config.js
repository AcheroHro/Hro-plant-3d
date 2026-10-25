/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cad: {
          dark: '#12161f',
          surface: '#1a202c',
          panel: '#232d3f',
          accent: '#00e5ff',
          warning: '#ffb300',
          danger: '#ff1744',
          success: '#00e676'
        }
      }
    },
  },
  plugins: [],
}
