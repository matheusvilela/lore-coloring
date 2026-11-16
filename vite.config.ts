import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/lore-coloring/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['letras/**'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,svg,ico,woff2}'],
        navigateFallback: '/lore-coloring/index.html',
      },
      manifest: {
        name: 'Colorir o Alfabeto Lore',
        short_name: 'Lore',
        description: 'App de colorir com as letras do Alphabet Lore',
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: '/lore-coloring/',
        scope: '/lore-coloring/',
        lang: 'pt-BR',
        icons: [
          {
            src: 'letras/A/thumb.webp',
            sizes: '192x192',
            type: 'image/webp',
          },
        ],
      },
    }),
  ],
});