# 🚀 Peribus Backend Server (Future)

## État : 🔴 DÉSACTIVÉ (Code prêt pour le futur)

Ce dossier contient tout le code serveur préparé pour une future migration vers notre propre infrastructure backend.

## Fonctionnalités préparées

### 1. 🗺️ Pathfinding (Calcul d'itinéraires)
- Algorithme RAPTOR pour le transport en commun
- A* pour la marche à pied
- Graphe de transport pré-calculé
- Support multi-modal

### 2. 📍 Autocomplétion de lieux
- Index Trie pour recherche rapide
- Recherche floue (fuzzy search)
- Support des accents et caractères spéciaux
- Arrêts de bus + POI locaux

### 3. 💾 Mémoire utilisateur
- Historique des recherches
- Lieux favoris
- Préférences de trajet
- Stockage SQLite/PostgreSQL ready

### 4. 🌐 API REST
- Routes Express.js
- Middleware d'authentification
- Rate limiting
- CORS configuré

## Structure des fichiers

```
server/
├── README.md              # Ce fichier
├── package.json           # Dépendances Node.js
├── config.js              # Configuration centralisée
├── index.js               # Point d'entrée (désactivé)
│
├── core/                  # Modules principaux
│   ├── pathfinding/       # Calcul d'itinéraires
│   │   ├── raptor.js      # Algorithme RAPTOR
│   │   ├── astar.js       # Algorithme A*
│   │   ├── graph.js       # Graphe de transport
│   │   └── index.js       # Export principal
│   │
│   ├── places/            # Autocomplétion
│   │   ├── trie.js        # Structure Trie
│   │   ├── fuzzy.js       # Recherche floue
│   │   ├── indexer.js     # Indexation des lieux
│   │   └── index.js       # Export principal
│   │
│   └── memory/            # Mémoire utilisateur
│       ├── store.js       # Interface stockage
│       ├── sqlite.js      # Adaptateur SQLite
│       ├── postgres.js    # Adaptateur PostgreSQL
│       └── index.js       # Export principal
│
├── api/                   # Routes API REST
│   ├── routes.js          # /api/routes
│   ├── places.js          # /api/places
│   ├── user.js            # /api/user
│   └── index.js           # Router principal
│
├── middleware/            # Middleware Express
│   ├── auth.js            # Authentification
│   ├── rateLimit.js       # Rate limiting
│   └── cors.js            # CORS
│
├── utils/                 # Utilitaires
│   ├── gtfsLoader.js      # Chargement GTFS
│   ├── geo.js             # Calculs géographiques
│   └── cache.js           # Système de cache
│
└── data/                  # Données pré-calculées
    └── .gitkeep
```

## Prérequis serveur recommandés

| Ressource | Minimum | Recommandé |
|-----------|---------|------------|
| RAM       | 1 GB    | 2-4 GB     |
| CPU       | 2 cores | 4 cores    |
| Stockage  | 5 GB    | 20 GB      |
| Node.js   | 18.x    | 20.x LTS   |

## Installation future

```bash
cd server
npm install
npm run build-graph  # Pré-calcul du graphe
npm start            # Démarrage du serveur
```

## Variables d'environnement

```env
# server/.env (à créer)
PORT=3000
NODE_ENV=production
DATABASE_URL=sqlite:./data/peribus.db
# ou PostgreSQL:
# DATABASE_URL=postgres://user:pass@host:5432/peribus

# Optionnel - APIs externes (backup)
GOOGLE_API_KEY=xxx
```

## Activation future

1. Héberger sur un VPS (OVH, Scaleway, Oracle Cloud)
2. Configurer les variables d'environnement
3. Modifier `public/js/config.js` pour pointer vers le nouveau serveur
4. Activer les routes API

---

**Note**: Ce code est préparé mais non testé en production.
Dernière mise à jour: Décembre 2025
