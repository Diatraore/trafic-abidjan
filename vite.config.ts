import { defineConfig } from 'vite'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    // Tailwind CSS v4 : génère uniquement les classes réellement utilisées
    tailwindcss(),
    adonisjs({
      /**
       * Fichiers d'entrée compilés par Vite (CSS et JavaScript du navigateur)
       */
      entrypoints: ['resources/css/app.css', 'resources/js/app.js', 'resources/js/map.js'],

      /**
       * Recharge le navigateur quand un gabarit Edge est modifié
       */
      reload: ['resources/views/**/*.edge'],
    }),
  ],
})
