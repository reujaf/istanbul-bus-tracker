/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.jsx",
    "./main.jsx"
  ],
  theme: {
    container: {
      center: false,
      padding: '0',
    },
    extend: {
      screens: {
        'xs': '320px',
        'sm': '480px',
        'md': '640px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      }
    }
  }
}
