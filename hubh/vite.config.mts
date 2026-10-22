import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ root: 'hubh', plugins: [react(), tailwindcss()], build: { outDir: '../hubh-dist', emptyOutDir: true }, base: './' });
