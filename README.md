<p align="center">
  <img src="https://i.ibb.co/99PZh9Zq/export6-removebg-preview.webp" alt="Périmap Logo" width="120" height="120">
</p>

<h1 align="center">🚌 Périmap</h1>

<p align="center">
  <strong>L'application moderne et gratuite pour les transports en commun de Périgueux</strong>
</p>

<p align="center">
  <a href="https://perimap.fr">🌐 perimap.fr</a> •
  <a href="https://instagram.com/perimap.fr">📸 Instagram</a> •
  <a href="https://facebook.com/perimap.fr">👍 Facebook</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.25.0-22c55e?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/PWA-Ready-00c8ff?style=flat-square" alt="PWA">
  <img src="https://img.shields.io/badge/GTFS-Péribus-orange?style=flat-square" alt="GTFS">
  <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="License">
</p>

---

## 📖 Table des matières

1. [Pourquoi ce projet ?](#-pourquoi-ce-projet-)
2. [Fonctionnalités actives](#-fonctionnalités-actives)
3. [Comment ça fonctionne](#-comment-ça-fonctionne)
4. [Architecture technique](#-architecture-technique)
5. [Installation et Développement](#-installation--développement)
6. [En construction](#-en-construction)
7. [Roadmap](#-roadmap)
8. [Identité visuelle](#-identité-visuelle)
9. [Contribuer](#-contribuer)

---

## 💡 Pourquoi ce projet ?

### L'origine

Je suis un utilisateur quotidien du réseau **Péribus** à Périgueux. Comme beaucoup, je lisais les fiches horaires, ou utilisait hawk. Mais je rencontrais régulièrement des **frustrations** :

- ❌ Interface peu intuitive, et illisible 
- ❌ Temps de chargement longs
- ❌ Pas de visualisation claire des lignes sur une carte
- ❌ Aucune centralisation des données
- ❌ On ne peut pas planifier ses trajets sauf en lisant les fiches horaires longues, remplis, et illisibles
- ❌ Difficile de savoir où est le bus en temps réel
- ❌ Pas de mode hors-ligne

### La solution

J'ai décidé de créer **Périmap** : une application web moderne, rapide et gratuite qui offre une **meilleure expérience utilisateur** tout en utilisant les mêmes données officielles GTFS du réseau Péribus.

### Les objectifs

| Objectif | Statut |
|----------|--------|
| Interface moderne et intuitive | ✅ |
| Carte interactive avec toutes les lignes | ✅ |
| Position des bus en temps réel (estimée) | ✅ |
| Calcul d'itinéraire multimodal | ✅ |
| Fonctionne hors-ligne | ✅ |
| 100% gratuit, sans pub, sans tracking | ✅ |
| Open source | ✅ |

---

## ✅ Fonctionnalités actives

### 🗺️ Carte interactive

| Fonctionnalité | Description |
|----------------|-------------|
| **Toutes les lignes** | 13 lignes Péribus avec leurs couleurs officielles |
| **Tous les arrêts** | ~1300 arrêts cliquables avec infos |
| **Tracés des lignes** | Polylines fidèles aux trajets réels |
| **Mode sombre** | Carte adaptée au thème choisi |
| **Géolocalisation** | Centrage sur votre position |

### 🚌 Bus en temps réel

| Fonctionnalité | Description |
|----------------|-------------|
| **Position estimée** | Calcul basé sur les horaires GTFS + interpolation |
| **Animation fluide** | Les bus se déplacent sur la carte |
| **Direction affichée** | Flèche indiquant le sens de circulation |
| **Infos au clic** | Ligne, direction, prochain arrêt |

> ⚠️ Les positions sont **estimées** à partir des horaires théoriques, pas du GPS réel des bus.

### 🧭 Calcul d'itinéraire

| Fonctionnalité | Description |
|----------------|-------------|
| **Multimodal** | Bus Péribus + marche à pied |
| **Autocomplétion** | Recherche intelligente des lieux |
| **Plusieurs options** | Jusqu'à 5 itinéraires proposés |
| **Détail complet** | Horaires, correspondances, durée de marche |
| **Tracé sur carte** | Visualisation du trajet complet |

### 📅 Horaires

| Fonctionnalité | Description |
|----------------|-------------|
| **Par arrêt** | Tous les passages à un arrêt |
| **Par ligne** | Horaires complets d'une ligne |
| **Temps réel** | Affichage "dans X min" |
| **Fiches horaires** | PDF officiels téléchargeables |

### 📱 PWA (Progressive Web App)

| Fonctionnalité | Description |
|----------------|-------------|
| **Installable** | Ajoutez l'app sur votre écran d'accueil |
| **Hors-ligne** | Fonctionne sans connexion internet |
| **Rapide** | Données en cache, chargement instantané |
| **Mises à jour auto** | Toujours la dernière version |

### 🎨 Interface

| Fonctionnalité | Description |
|----------------|-------------|
| **Mode sombre/clair** | Selon vos préférences ou automatique |
| **Responsive** | Adapté mobile, tablette, desktop |
| **Animations fluides** | Transitions soignées |
| **Accessibilité** | Contrastes respectés, navigation clavier |

---

## ⚙️ Comment ça fonctionne

### Architecture simplifiée

```
┌─────────────────────────────────────────────────────────────────┐
│                        UTILISATEUR                              │
│                    (navigateur web/PWA)                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Vanilla JS)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │    Carte    │  │  Itinéraire  │  │       Horaires          │ │
│  │  Leaflet.js │  │    UI/UX     │  │     GTFS Parser         │ │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│  DONNÉES GTFS   │ │   API Google    │ │     OpenStreetMap       │
│  (statiques)    │ │  (via Vercel)   │ │    (tuiles carte)       │
│                 │ │                 │ │                         │
│  • stops.txt    │ │  • Places API   │ │  • CARTO Dark/Light     │
│  • routes.txt   │ │  • Routes API   │ │  • Leaflet.js           │
│  • trips.txt    │ │  • Geocode API  │ │                         │
│  • stop_times   │ │                 │ │                         │
│  • calendar     │ │ (proxy sécurisé │ │                         │
│  • shapes       │ │  clé cachée)    │ │                         │
└─────────────────┘ └─────────────────┘ └─────────────────────────┘
```

### Flux de données

#### 1️⃣ Chargement initial
```
Utilisateur ouvre l'app
    → Service Worker vérifie le cache
    → Charge les données GTFS (bundle JSON optimisé)
    → Construit les index en mémoire
    → Affiche la carte avec les lignes
```

#### 2️⃣ Calcul d'itinéraire
```
Utilisateur saisit origine/destination
    → Autocomplétion via Google Places API (proxy Vercel)
    → Sélection des lieux
    → Recherche des arrêts GTFS proches
    → Algorithme hybride :
        • GTFS local pour les bus
        • Google Routes API pour la marche
    → Affichage des résultats classés
    → Tracé sur la carte
```

#### 3️⃣ Position des bus
```
Toutes les 5 secondes :
    → Récupère l'heure actuelle
    → Pour chaque trip actif :
        • Trouve la position entre 2 arrêts
        • Interpole les coordonnées
        • Calcule l'orientation
    → Anime les marqueurs sur la carte
```

### Technologies utilisées

| Catégorie | Technologie | Rôle |
|-----------|-------------|------|
| **Frontend** | JavaScript ES6+ (Vanilla) | Logique applicative |
| **Carte** | Leaflet.js | Affichage cartographique |
| **Tuiles** | CARTO (basé OSM) | Fond de carte |
| **Données transport** | GTFS Péribus | Horaires, arrêts, lignes |
| **Géocodage** | Google Places API | Autocomplétion adresses |
| **Itinéraires piétons** | Google Routes API | Trajets à pied |
| **Hébergement** | Vercel | CDN + Serverless Functions |
| **PWA** | Service Worker | Cache et offline |

### Sécurité des APIs

Les clés API Google ne sont **jamais exposées** côté client :

```
Client                    Vercel (Serverless)              Google
  │                              │                            │
  │  POST /api/places            │                            │
  │  {query: "Gare"}             │                            │
  │ ────────────────────────────>│                            │
  │                              │   + API Key (env secret)   │
  │                              │ ──────────────────────────>│
  │                              │                            │
  │                              │         Résultats          │
  │                              │ <──────────────────────────│
  │      Résultats filtrés       │                            │
  │ <────────────────────────────│                            │
```

---

## 🏗️ Architecture technique

### Structure du projet

```
perimap/
├── 📁 public/                    # Application frontend
│   ├── index.html               # Page principale (SPA)
│   ├── about.html               # À propos + Admin
│   ├── mentions-legales.html    # Légal
│   ├── style.css                # Styles (~10K lignes)
│   ├── manifest.json            # PWA manifest
│   ├── service-worker.js        # Cache et offline
│   │
│   ├── 📁 js/                   # JavaScript
│   │   ├── app.js               # Point d'entrée, init
│   │   ├── main.js              # Logique principale
│   │   ├── config.js            # Configuration runtime
│   │   ├── dataManager.js       # Gestion données GTFS
│   │   ├── mapRenderer.js       # Carte Leaflet
│   │   ├── apiManager.js        # APIs Google
│   │   ├── timeManager.js       # Gestion temps
│   │   ├── tripScheduler.js     # Positions bus
│   │   ├── uiManager.js         # UI et thèmes
│   │   ├── router.js            # Calcul itinéraires
│   │   ├── 📁 workers/          # Web Workers
│   │   ├── 📁 utils/            # Utilitaires
│   │   └── 📁 ui/               # Composants UI
│   │
│   ├── 📁 views/                # Templates HTML
│   │   ├── carte.html
│   │   ├── horaires.html
│   │   ├── itineraire.html
│   │   └── ...
│   │
│   ├── 📁 data/                 # Données
│   │   ├── 📁 gtfs/             # Données Péribus
│   │   ├── map.geojson          # Tracés lignes
│   │   └── line-status.json     # État trafic
│   │
│   └── 📁 icons/                # Icônes PWA
│
├── 📁 api/                      # Serverless Functions (Vercel)
│   ├── places.js                # Proxy Google Places
│   ├── routes.js                # Proxy Google Routes
│   ├── geocode.js               # Proxy Geocoding
│   └── admin-token.js           # Auth admin
│
├── 📁 server/                   # 🔴 BACKEND FUTUR (désactivé)
│   └── ...                      # Voir section "En construction"
│
├── 📁 scripts/                  # Scripts utilitaires
│   └── preprocess-gtfs.mjs      # Prétraitement GTFS
│
└── README.md                    # Ce fichier
```

### Modules principaux

| Module | Responsabilité |
|--------|----------------|
| app.js | Initialisation, chargement GTFS, routing SPA |
| dataManager.js | Parsing GTFS, indexation, requêtes |
| mapRenderer.js | Carte Leaflet, marqueurs, polylines |
| tripScheduler.js | Calcul positions bus en temps réel |
| router.js | Algorithme d'itinéraire hybride |
| apiManager.js | Appels API Google via proxies |

---

## 🛠️ Installation et Développement

### Prérequis

- Node.js 18+ (optionnel, pour scripts)
- Serveur HTTP local (Live Server, Python...)
- Navigateur moderne

### Lancement local

```bash
# 1. Cloner le repo
git clone https://github.com/EFFEZFEZ/p-rimap-sans-api-.git
cd p-rimap-sans-api-

# 2. Lancer un serveur local
# Option A : VS Code Live Server (recommandé)
# Option B : Python
python -m http.server 8080 --directory public

# 3. Ouvrir http://localhost:8080
```

### Variables d'environnement (Vercel)

Pour le déploiement, configurer dans Vercel :

```env
GOOGLE_API_KEY=votre_clé_google_api
ADMIN_TOKEN=token_pour_admin
```

### Mise à jour des données GTFS

```bash
# Télécharger les nouvelles données depuis le site Péribus
# Puis lancer le prétraitement :
node scripts/preprocess-gtfs.mjs
```

---

## 🚧 En construction

Le dossier server/ contient le code **préparé mais désactivé** pour un futur backend autonome.

### 🤔 Pourquoi un backend futur ?

| Actuellement | Futur envisagé |
|--------------|----------------|
| API Google (quota gratuit) | Notre propre système |
| Dépendance externe | Autonomie totale |
| Pas de personnalisation | Favoris, historique, préférences |

### 📦 Ce qui est préparé

```
server/
├── 📁 core/
│   ├── 📁 pathfinding/          # 🗺️ Calcul d'itinéraires
│   │   ├── raptor.js            # Algorithme RAPTOR (référence mondiale)
│   │   ├── astar.js             # A* pour la marche
│   │   └── graph.js             # Graphe de transport
│   │
│   ├── 📁 places/               # 📍 Autocomplétion maison
│   │   ├── trie.js              # Structure Trie (recherche O(m))
│   │   ├── fuzzy.js             # Recherche floue (fautes de frappe)
│   │   └── indexer.js           # Indexation arrêts + POI
│   │
│   └── 📁 memory/               # 💾 Mémoire utilisateur
│       ├── store.js             # Interface stockage
│       ├── sqlite.js            # Adaptateur SQLite
│       └── postgres.js          # Adaptateur PostgreSQL
│
├── 📁 api/                      # Routes REST
├── 📁 middleware/               # Auth, CORS, Rate limiting
├── 📁 utils/                    # Utilitaires
└── README.md                    # Documentation détaillée
```

### ❓ Pourquoi c'est désactivé ?

| Raison | Explication |
|--------|-------------|
| **Serveur requis** | Nécessite un serveur 24/7 (~5-15 euros/mois) |
| **Google fonctionne** | Le système actuel est gratuit et fiable |
| **Priorité** | Focus sur les fonctionnalités utilisateur d'abord |

### 🔧 Comment l'activer (futur)

```bash
cd server
npm install
cp .env.example .env  # Configurer
npm run build-graph   # Pré-calculer le graphe
npm start             # Démarrer le serveur
```

---

## 🗺️ Roadmap

### ✅ Fait

- [x] Carte interactive avec toutes les lignes
- [x] Position des bus en temps réel (estimée)
- [x] Calcul d'itinéraire multimodal
- [x] Mode hors-ligne (PWA)
- [x] Mode sombre/clair
- [x] Horaires par arrêt et par ligne
- [x] Fiches horaires PDF
- [x] Page info trafic
- [x] Page tarifs

### 🔄 En cours

- [ ] Amélioration de la précision des positions bus
- [ ] Optimisation du calcul d'itinéraire

### 📋 Prévu (court terme)

- [ ] Notifications de perturbations
- [ ] Widget "prochain bus" sur l'écran d'accueil
- [ ] Partage d'itinéraire

### 🔮 Prévu (long terme)

- [ ] Backend autonome (RAPTOR + autocomplétion maison)
- [ ] Comptes utilisateur (favoris, historique)
- [ ] Intégration vélos en libre service (si disponible)
- [ ] API temps réel officielle (si Péribus la fournit)

---

## 🎨 Identité visuelle

### Couleurs officielles

| Couleur | Code | Usage |
|---------|------|-------|
| **Vert Périmap** | #22c55e | Primaire, boutons, liens |
| **Cyan** | #00c8ff | Secondaire, accents |
| **Gradient** | #22c55e vers #00c8ff | Signature visuelle |

### Palette Dark Mode

```css
--pm-bg-page: #0b1220;
--pm-bg-card: #0f1724;
--pm-text-primary: #e6eef8;
--pm-text-secondary: #9fb3c9;
```

### Palette Light Mode

```css
--pm-bg-page: #f8fafc;
--pm-bg-card: #ffffff;
--pm-text-primary: #0f172a;
--pm-text-secondary: #64748b;
```

### Typographie

- **Police** : Manrope (Google Fonts)
- **Fallback** : -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! 

### Comment contribuer

1. **Fork** le projet
2. **Créer** une branche (git checkout -b feature/ma-feature)
3. **Commit** les changements (git commit -m 'Ajout de ma feature')
4. **Push** (git push origin feature/ma-feature)
5. **Ouvrir** une Pull Request

### Signaler un bug

Ouvrez une issue avec :
- Description du problème
- Étapes pour reproduire
- Capture d'écran si possible

---

## 📄 Licence

Ce projet est sous licence **MIT**. Voir le fichier LICENSE pour plus de détails.

---

## 🙏 Remerciements

- **Péribus** pour les données GTFS ouvertes
- **OpenStreetMap** pour les données cartographiques
- **Leaflet.js** pour la bibliothèque de cartographie
- La communauté open source

---

<p align="center">
  <strong>Fait avec ❤️ à Périgueux</strong>
</p>

<p align="center">
  <a href="https://perimap.fr">perimap.fr</a>
</p>