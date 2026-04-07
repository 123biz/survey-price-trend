import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = new URL(env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co')
  const supabaseOrigin = supabaseUrl.origin

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        devOptions: { enabled: false },

        manifest: {
          name: '설문 가격 트렌드 관리',
          short_name: '가격트렌드',
          description: '업체별 일일 가격 동향 조사 및 관리 시스템',
          start_url: '/admin',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#ffffff',
          theme_color: '#863bff',
          lang: 'ko',
          icons: [
            { src: '/icons/icon-72x72.png',   sizes: '72x72',   type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-96x96.png',   sizes: '96x96',   type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          ],
        },

        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            // Supabase REST API — NetworkFirst (최신 데이터 우선, 오프라인 시 캐시 폴백)
            {
              urlPattern: ({ url }) =>
                url.origin === supabaseOrigin && url.pathname.startsWith('/rest/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-rest-cache',
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Supabase Realtime/Auth — NetworkOnly (캐시 불가)
            {
              urlPattern: ({ url }) =>
                url.origin === supabaseOrigin &&
                (url.pathname.startsWith('/realtime/') || url.pathname.startsWith('/auth/')),
              handler: 'NetworkOnly',
            },
            // 앱 아이콘 — CacheFirst 30일
            {
              urlPattern: /\/icons\/.*\.png$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'app-icons',
                expiration: { maxEntries: 20, maxAgeSeconds: 2592000 },
              },
            },
          ],
        },
      }),
    ],
  }
})
