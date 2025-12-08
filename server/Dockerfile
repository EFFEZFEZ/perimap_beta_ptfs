# Copyright © 2025 Périmap - Tous droits réservés
# Backend Périmap - image Node

FROM node:18-slim
WORKDIR /app

# Installer deps
COPY package*.json ./
RUN npm install --production

# Copier le code
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
