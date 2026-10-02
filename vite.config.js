import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'firebase-app': ['firebase/app'],
          'firebase-auth': ['firebase/auth'],
          'firebase-firestore': ['firebase/firestore'],
          'firebase-functions': ['firebase/functions']
        }
      }
    }
  }
});
