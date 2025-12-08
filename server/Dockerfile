# Copyright © 2025 Périmap - Tous droits réservés
# Backend Périmap - image Node

FROM node:18-slim
WORKDIR /app

# Installer deps
COPY server/package*.json ./
RUN npm install --production

# Copier le code serveur
COPY server . 

# Copier les fichiers publics
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
