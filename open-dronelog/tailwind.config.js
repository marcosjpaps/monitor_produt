/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Open DroneLog color scheme
        drone: {
          primary: 'rgb(var(--drone-primary) / <alpha-value>)',
          secondary: 'rgb(var(--drone-secondary) / <alpha-value>)',
          accent: 'rgb(var(--drone-accent) / <alpha-value>)',
          dark: 'rgb(var(--drone-dark) / <alpha-value>)',
          surface: 'rgb(var(--drone-surface) / <alpha-value>)',
          muted: 'rgb(var(--drone-muted) / <alpha-value>)',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
