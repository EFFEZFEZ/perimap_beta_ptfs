# Synthèse projet PériMap + migration (Google → API auto-hébergée)

Date: 22/12/2025

Objectif de ce document:
- Expliquer **tout le projet** (rôle de chaque dossier / composant).
- Distinguer ce qui vient de l’**ancien projet Vercel + APIs Google** (souvent encore présent mais **non utilisé** en local Docker).
- Décrire ce qu’il faut **mettre en état** pour un futur site **hébergé par vous**, avec **votre propre API**.

---

## 1) Vue d’ensemble (ce que fait PériMap)

PériMap est une PWA (web app installable) pour le réseau Péribus (Périgueux) qui fournit:
- Carte (Leaflet + données GTFS)
- Horaires (données GTFS)
- Itinéraires (multimodal)
- Infos trafic / état du réseau
- Mode offline via service worker

Deux “générations” cohabitent dans ce workspace:
1) **Génération A (legacy)**: hébergement type Vercel + fonctions serverless dans le dossier `api/` qui proxifient **Google Places / Google Routes**.
2) **Génération B (auto-hébergée)**: stack Docker locale avec **Express (server/)** + **OpenTripPlanner (OTP)** + **Photon**.

---

## 2) Cartographie des dossiers (ce qui sert à quoi)

### 2.1 `public/` — Frontend (PWA)
Contient l’application servie au navigateur:
- `public/index.html` (+ autres pages HTML éventuellement indexables)
- `public/style.css` (design)
- `public/js/*` (logique UI, carte, itinéraires, trafic)
- `public/service-worker.js` (cache/offline)
- `public/data/*` (GTFS bundle + fichiers annexes)

Point important:
- Le frontend appelle des endpoints via `public/js/config.js` et `public/js/apiManager.js`.
- Dans cette version “auto-hébergée”, les endpoints utilisés sont **relatifs**: `/api/routes`, `/api/places`, `/api/realtime`.

### 2.2 `server/` — Backend Express (API auto-hébergée)
Contient un serveur Node/Express qui:
- sert le frontend (`public/`) en statique
- expose une API:
  - `/api/routes` → routage via OTP (itinéraires)
  - `/api/places` → autocomplétion/géocodage via Photon (avec fallback)
  - `/api/realtime` → (optionnel) GTFS-RT

Ce backend a aussi une partie “architecture GTFS centralisée”:
- chargement des données GTFS côté serveur
- enrichissement des réponses OTP avec couleurs/noms de ligne (pour que le front n’ait pas à “deviner”)

### 2.3 `data/` — Données lourdes (OTP, Photon, OSM)
- `data/otp/graphs/default/` : graphe OTP + GTFS/OSM nécessaires
- `data/*/*.osm.pbf` : extraits OpenStreetMap

### 2.4 `api/` — Fonctions serverless legacy (Vercel / Google)
Ce dossier correspond au **premier projet** “qui fonctionne par API Google”:
- `api/places.js` : proxy vers **Google Places** (autocomplete + place details)
- `api/routes.js` : proxy vers **Google Routes** (computeRoutes) + cache CDN Vercel
- `api/geocode.js` : reverse geocode Google

Important:
- En **mode Docker auto-hébergé**, ce dossier `api/` est **généralement non utilisé**, car c’est `server/index.js` qui sert `/api/*`.
- Donc des modifications dans `api/` peuvent n’avoir **aucun impact** sur votre stack locale Docker.

### 2.5 Docs à lire (référence)
- `DEPLOYMENT.md` : comment lancer la stack auto-hébergée (OTP + API)
- `INDEX.md` + `GTFS_ARCHITECTURE_V2.md` + `GTFS_DEVELOPER_GUIDE.md` : explication de l’architecture GTFS côté serveur

---

## 3) Les 2 modes d’exécution (et comment les reconnaître)

### 3.1 Mode legacy (Vercel + Google)
**Qui fait quoi**
- Frontend statique (Vercel)
- Dossier `api/` = endpoints serverless:
  - Google Places: autocomplétion / résolution
  - Google Routes: marche/vélo/transit
  - Google Geocode: reverse

**Pré-requis**
- Variable serveur: `GMAPS_SERVER_KEY`

**Avantages**
- Itinéraires “walking/bicycle” gérés par Google
- Bonne qualité d’autocomplétion

**Inconvénients**
- Dépendance forte à Google (coût, quotas, lock-in)
- Architecture “proxy Vercel” non réutilisable telle quelle en auto-hébergement

### 3.2 Mode auto-hébergé (Express + OTP + Photon)
C’est le mode décrit dans `docker-compose.yml`.

**Qui fait quoi**
- `otp` (conteneur) expose OTP sur le port hôte `8888`.
- `api` (conteneur Express) expose le site + API sur le port hôte `8080`.
- Photon est consommé via `PHOTON_BASE_URL` (par défaut `https://photon.komoot.io`).

**Endpoints utilisés par le front**
- `public/js/config.js` définit:
  - `routes: '/api/routes'`
  - `places: '/api/places'`
  - `realtime: '/api/realtime'`

**Avantages**
- Plus de dépendance à Google
- Contrôle complet (routage + données)
- Possibilité d’enrichir OTP avec vos métadonnées GTFS (couleurs, labels)

**Inconvénients**
- OTP à maintenir (graph build, mémoire, temps de démarrage)
- Photon public = dépendance externe (peut être auto-hébergé aussi)

---

## 4) Ce qui est “hérité / sans impact local” vs “actif”

### Actif en local (stack Docker actuelle)
- `docker-compose.yml`
- `server/*` (Express + API)
- `public/*` (front)
- `data/otp/*` (graph OTP + OSM/GTFS)

### Hérité (principalement legacy Google)
- `api/*` (proxies Google Vercel)

=> Si vous ne déployez pas sur Vercel avec les fonctions `api/`, alors **`api/*` n’impacte pas** votre site Docker.

### Cas particulier: fichiers “SEO / pages HTML / robots / sitemap”
- `public/robots.txt`, `public/sitemap.xml`, pages `public/horaires*.html`, `public/trafic.html`, `public/carte.html`, `public/itineraire.html`…

Ces fichiers:
- sont utiles surtout quand le site est **hébergé publiquement** et doit être indexé.
- ont peu d’impact sur le fonctionnement “SPA/PWA” (puisque l’app vit surtout sur `/#...`).
- restent servis en local (donc visibles), mais ne changent pas la logique métier.

---

## 5) Résumé des modifications récentes (cette conversation)

Un résumé détaillé des modifs UI/infra de la session du 22/12/2025 est déjà dans:
- `RESUME_MODIFICATIONS_2025-12-22_Civia-Mobilite.md`

En très court, cette session a surtout touché:
- Frontend: style + rendu itinéraires + trafic + modals
- Backend: robustesse du service statique `public/` en Docker/local

---

## 6) Ce qu’il faut “mettre en état” pour le futur site hébergé par vous (API maison)

### 6.1 Décision d’architecture (recommandation pragmatique)
Pour un futur site “hébergé chez vous”, le plus simple est de garder le modèle:
- Reverse proxy (Nginx/Caddy/Traefik)
- Conteneur `api` (Express) qui sert **front + API**
- Conteneur `otp`
- (Optionnel) Conteneur `photon`

### 6.2 Checklist technique “mise en prod”
1) **Domaine + HTTPS**
   - Mettre un reverse proxy devant `api`.
   - TLS (Let’s Encrypt).

2) **Variables d’environnement** (prod)
   - `OTP_BASE_URL` vers le service OTP interne.
   - `PHOTON_BASE_URL`:
     - soit photon public (rapide mais dépendance)
     - soit photon auto-hébergé (recommandé si vous voulez 100% autonomie)
   - `CORS_ORIGINS` sur votre domaine.
   - `GTFS_RT_URL` si vous branchez un flux temps réel.

3) **Données OTP (GTFS + OSM)**
   - Pipeline de mise à jour:
     - déposer un nouveau `gtfs.zip`
     - reconstruire le graph OTP
     - redémarrer OTP (ou procédure de reload si vous l’implémentez)

4) **Observabilité**
   - logs centralisés (au minimum `docker compose logs` + rotation)
   - healthchecks:
     - `/health` (Express)
     - `/api/routes/health` (OTP)

5) **Perf / cache**
   - Service worker OK côté front.
   - Côté API, décider cache sur `/api/places/autocomplete` (ex: 30–60s) + limiter le spam.

6) **Sécurité**
   - rate limit (déjà présent côté serveur)
   - admin endpoints: auth obligatoire si vous en ajoutez

### 6.3 Migration depuis “Google APIs”
Si votre front est déjà en mode `/api/routes` + `/api/places` (c’est le cas ici), alors:
- vous n’avez plus besoin de `GMAPS_SERVER_KEY`.
- le dossier `api/` (Google/Vercel) peut être considéré “legacy”.

### 6.4 Points à valider fonctionnellement avant mise en prod
- Autocomplétion: qualité Photon vs besoins (et fallback local).
- Routage: OTP répond correctement dans votre zone (graph correct).
- Affichage couleurs de lignes: enrichissement GTFS serveur OK.
- Offline/PWA: service worker versioning maîtrisé.

---

## 7) Recommandations “nettoyage / clarification” (optionnel)

Pour éviter la confusion entre les deux générations:
- Mettre à jour `README.md` (qui décrit encore Google/Vercel) pour refléter le mode auto-hébergé.
- Documenter clairement:
  - “`api/` = legacy Vercel Google”
  - “`server/` = API auto-hébergée actuelle”

---

## 8) Prochaine étape (si tu veux que je le fasse)

Je peux:
1) compléter `RESUME_MODIFICATIONS_2025-12-22_Civia-Mobilite.md` avec une section “SEO/PWA/pages HTML”
2) ou écrire une checklist de déploiement “prod” (Nginx/Caddy + DNS + TLS + ports + hardening) adaptée à votre infra
