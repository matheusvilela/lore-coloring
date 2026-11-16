import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/lore-coloring/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon.svg',
        'favicon-32.png',
        'apple-touch-icon.png',
        'icons/**',
        'letras/**',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webp,svg,ico,woff2}'],
        navigateFallback: '/lore-coloring/index.html',
      },
      manifest: {
        name: 'Colorir o Alfabeto Lore',
        short_name: 'Colorir Lore',
        description: 'App de colorir com as letras do Alphabet Lore',
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: '/lore-coloring/',
        scope: '/lore-coloring/',
        lang: 'pt-BR',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});