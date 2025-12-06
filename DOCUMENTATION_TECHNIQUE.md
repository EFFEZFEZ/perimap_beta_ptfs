# 📚 DOCUMENTATION TECHNIQUE - PÉRIMAP

**Version**: V221 | **Dernière mise à jour**: 6 décembre 2025

---

## Table des matières

1. [Résumé du projet](#1-résumé-du-projet)
2. [Architecture technique](#2-architecture-technique)
3. [Flux de données critiques](#3-flux-de-données-critiques)
4. [Fichiers critiques](#4-fichiers-critiques)
5. [Bugs majeurs corrigés](#5-bugs-majeurs-corrigés)
6. [API Google Routes](#6-api-google-routes)
7. [Refactorisation V221](#7-refactorisation-v221)
8. [Guide de debug](#8-guide-de-debug)
9. [Analyse business](#9-analyse-business)

---

## 1. Résumé du projet

### Qu'est-ce que Périmap ?

Périmap est une **Progressive Web App (PWA) non-officielle** pour le réseau de bus Péribus du Grand Périgueux.

**Fonctionnalités principales :**
- Consultation des horaires en temps réel (basés sur données GTFS)
- Calcul d'itinéraires multimodaux (bus, marche, vélo) via Google Routes API
- Carte interactive avec positions des bus (estimées, pas GPS réel)
- Mode hors-ligne via Service Worker
- Interface moderne dark/light mode

**Stack technique :**
| Composant | Technologie |
|-----------|-------------|
| Frontend | Vanilla JS (ES Modules), Leaflet, CSS Grid/Flexbox |
| Backend | Proxies Vercel (Node.js) - `/api/routes`, `/api/places`, `/api/geocode` |
| Données | GTFS statiques + Google Routes API |
| Cache | IndexedDB + Service Worker |

### État du projet

| Critère | Évaluation |
|---------|------------|
| Architecture code | ✓ Propre, modulaire, bien structurée |
| PWA | ✓ Complète (manifest, SW, offline) |
| SEO | ✓ Très bien optimisé |
| Design | ✓ Moderne, cohérent |
| Fonctionnalités | ⚠ Partielles (temps réel simulé) |
| Tests | ✗ Absents |

---

## 2. Architecture technique

### Structure des fichiers JS

```
public/js/
├── main.js              # Orchestration principale (~4500 lignes)
├── app.js               # Point d'entrée HTML
├── config.js            # Configuration (API keys via env)
│
├── config/
│   ├── icons.js         # SVG icons centralisés
│   └── routes.js        # Mapping lignes/couleurs
│
├── map/
│   └── routeDrawing.js  # ✨ V221: Dessin routes Leaflet
│
├── search/
│   └── itineraryProcessor.js  # ✨ V221: Traitement itinéraires
│
├── itinerary/
│   └── ranking.js       # Tri/filtrage résultats
│
├── ui/
│   ├── resultsRenderer.js  # Affichage résultats
│   └── trafficInfo.js      # Alertes trafic
│
├── utils/
│   ├── formatters.js    # Formatage dates/heures
│   ├── geo.js           # Utilitaires géographiques
│   ├── polyline.js      # Encodage/décodage polylines
│   └── gtfsProcessor.js # Traitement GTFS
│
├── workers/
│   ├── gtfsWorker.js    # Worker GTFS (IndexedDB)
│   └── routerWorker.js  # Worker calcul routes
│
└── [autres managers]    # apiManager, dataManager, uiManager, etc.
```

### API Proxies (Vercel Functions)

| Route | Fichier | Rôle |
|-------|---------|------|
| `/api/routes` | `api/routes.js` | Proxy Google Routes API |
| `/api/places` | `api/places.js` | Proxy Google Places API |
| `/api/geocode` | `api/geocode.js` | Proxy Google Geocoding API |

---

## 3. Flux de données critiques

### Recherche d'itinéraire

```
[1] UTILISATEUR
     │
     ▼
[2] uiManager.js → Collecte from/to/searchTime
     │
     ▼
[3] main.js::executeItinerarySearch()
     │
     ├──► [4a] router.js (GTFS local) → 0 résultats (souvent)
     │
     └──► [4b] apiManager.js::fetchItinerary()
              │
              ├── Mode "partir" : 8 appels API décalés (T+0 à T+180min)
              └── Mode "arriver" : 1 seul appel API
                    │
                    ▼
          [5] extractDepartureTime()
              │
              ▼
          [6] Déduplication par uniqueKey
              │
              ▼
          [7] Tri par heure de départ
              │
              ▼
          [8] Limite à 8 résultats
              │
              ▼
[9] main.js::processIntelligentResults()
     │
     ▼
[10] ranking.js::filterExpiredDepartures()
     │
     ▼
[11] resultsRenderer.js → Affichage
```

### Mode "Partir" vs "Arriver"

| Aspect | Mode "Partir à" | Mode "Arriver à" |
|--------|-----------------|------------------|
| Objectif | Partir à une heure précise | Arriver avant une heure |
| Appels API | 8 décalés (T+0 à T+180min) | 1 seul appel |
| Paramètre API | `departureTime` | `arrivalTime` |
| Filtrage départs | >= heure demandée | >= heure ACTUELLE |
| Filtrage arrivées | - | <= heure demandée |
| Tri | Départ croissant | Arrivée décroissante |

---

## 4. Fichiers critiques

### Ne pas casser !

| Fichier | Lignes | Zones sensibles |
|---------|--------|-----------------|
| `apiManager.js` | ~1117 | `extractDepartureTime()`, `uniqueKey`, `_offsetSearchTime()` |
| `ranking.js` | ~374 | `filterExpiredDepartures()`, `filterLateArrivals()` |
| `main.js` | ~4531 | `executeItinerarySearch()`, `processIntelligentResults()` |
| `dataManager.js` | ~1570 | `getTripsBetweenStops()`, `getServiceIds()` |
| `service-worker.js` | ~193 | `CACHE_VERSION` (incrémenter à chaque déploiement) |

---

## 5. Bugs majeurs corrigés

| Version | Bug | Cause | Fix |
|---------|-----|-------|-----|
| V217 | Saut d'horaires (14:04 → 15:53) | Mauvais chemin extraction `depTime` | Helper `extractDepartureTime()` |
| V217 | Déduplication trop agressive | `uniqueKey = ""-lineName` (vide) | Clé = `depTime-line-stop` |
| V219 | Mode arriver = 0 bus | 8 appels avec `arrivalTime` décalés dans le passé | 1 seul appel en mode arriver |
| V220 | Mode arriver filtre tous les bus | Comparaison départ vs heure demandée | Comparer à heure ACTUELLE |

---

## 6. API Google Routes

### Structure de la réponse (mode TRANSIT)

```
route
├── duration: "3660s"
├── distanceMeters: 12500
├── polyline: { encodedPolyline: "..." }
└── legs[]
    └── [0]
        ├── localizedValues
        │   └── departureTime  ◄── VIDE pour TRANSIT !
        └── steps[]
            ├── [0] travelMode: "WALK"
            ├── [1] travelMode: "TRANSIT" ◄── C'EST LÀ
            │   └── transitDetails
            │       ├── transitLine
            │       │   └── nameShort: "A"
            │       └── localizedValues
            │           ├── departureTime.time.text: "14:04" ◄── BONNE VALEUR
            │           └── arrivalTime.time.text: "14:52"
            └── [2] travelMode: "WALK"
```

**Règle d'or** : Pour les routes TRANSIT, toujours parcourir `steps[]` et chercher `travelMode === 'TRANSIT'`, puis extraire de `transitDetails`.

### Déduplication

```
uniqueKey = `${depTime}-${lineName}-${depStopName}`

Exemples :
  "14:04-A-Gare SNCF"     ✓ Gardé
  "14:04-A-Gare SNCF"     ✗ Doublon, ignoré
  "14:24-A-Gare SNCF"     ✓ Gardé (heure différente)
  "14:04-B-Gare SNCF"     ✓ Gardé (ligne différente)
```

---

## 7. Refactorisation V221

### Résumé des changements

| Métrique | Avant | Après | Delta |
|----------|-------|-------|-------|
| Fichiers JS | 32 | 24 | **-8** |
| Lignes code mort | ~1,828 | 0 | **-1,828** |
| Modules extraits | 0 | 2 | **+2** |

### Fichiers supprimés (code mort)

| Fichier | Lignes | Raison |
|---------|--------|--------|
| `modules/index.js` | 123 | Barrel jamais importé |
| `utils/logger.js` | 99 | Logger jamais utilisé |
| `utils/performance.js` | 125 | Throttle/debounce inline |
| `utils/theme.js` | 70 | Thème dans UIManager |
| `state/appState.js` | 156 | État dans variables globales |
| `ui/popoverManager.js` | 100 | Logique inline |
| `ui/detailRenderer.js` | 300 | Jamais importé |
| `controllers/bottomSheetController.js` | 200 | Logique dans main.js |
| `controllers/viewController.js` | 350 | Logique dans main.js |
| `search/googleRoutesProcessor.js` | 305 | Doublon de main.js |

### Nouveaux modules créés

#### `map/routeDrawing.js` (503 lignes)
Utilitaires de dessin de routes sur Leaflet.

**Exports :** `STOP_ROLE_PRIORITY`, `isWaitStep()`, `getPolylineLatLngs()`, `extractStepPolylines()`, `getLeafletStyleForStep()`

#### `search/itineraryProcessor.js` (511 lignes)
Traitement des réponses d'itinéraires.

**Exports :** `parseDepartureMinutes()`, `parseTimeToSeconds()`, `createItinerarySignature()`

---

## 8. Guide de debug

### Checklist sauts d'horaires

Si les horaires sautent (ex: 14:04 → 15:53) :

1. **Vérifier les logs console :**
   - `"📋 Horaires: 14:04, 14:24..."` → extraction OK
   - `"📋 Horaires: , , ..."` → extraction CASSÉE

2. **Vérifier la déduplication :**
   - `"🚍 V218: 8/21 trajets"` → OK
   - `"🚍 V218: 1/21 trajets"` → uniqueKey cassée

3. **Vérifier le filtrage :**
   - `"🕐 V205: Filtrage..."` → mode partir OK
   - `"🕐 V220: Mode ARRIVER..."` → mode arriver OK

4. **Points de rupture :**
   - `apiManager.js` ligne ~660 : `extractDepartureTime()`
   - `apiManager.js` ligne ~700 : construction `uniqueKey`
   - `ranking.js` ligne ~160 : `filterExpiredDepartures`

### Constantes importantes

```javascript
// apiManager.js
MAX_BUS_RESULTS = 8
Offsets mode partir : [0, 20, 40, 60, 90, 120, 150, 180] minutes

// ranking.js
MIN_BUS_ITINERARIES = 5
Marge de filtrage : -2 minutes

// main.js
ARRIVAL_PAGE_SIZE = 6

// service-worker.js
CACHE_VERSION = 'v221'
```

### Commandes Git utiles

```bash
# Voir les changements récents
git log --oneline -20 -- public/js/apiManager.js

# Comparer versions
git diff v217..v221 -- public/js/apiManager.js

# Revenir à une version
git checkout v217 -- public/js/apiManager.js

# Tag version stable
git tag -a v221-stable -m "Refactorisation complète"
```

---

## 9. Analyse business

### Forces du projet

1. **Qualité technique** : Architecture JS moderne, ES modules, Workers
2. **PWA exemplaire** : Installable, hors-ligne, shortcuts
3. **SEO poussé** : Schema.org, Open Graph, géolocalisation
4. **UX soignée** : Bottom sheet mobile, dark mode
5. **Données GTFS locales** : Pas de dépendance serveur

### Faiblesses

| Niveau | Problème |
|--------|----------|
| 🔴 Critique | Pas de temps réel GPS (positions calculées) |
| 🟠 Majeur | Dépendance Google Routes API (coûts potentiels) |
| 🟠 Majeur | Pas de tests automatisés |
| 🟡 Mineur | main.js encore volumineux (~4500 lignes) |

### Potentiel de monétisation

| Modèle | Viabilité | Notes |
|--------|-----------|-------|
| Publicité | Faible | Trop peu d'utilisateurs |
| Partenariat collectivité | **Fort** | Meilleure option |
| White-label multi-villes | Possible | Code réutilisable |

### Prochaines étapes recommandées

**Haute priorité :**
- [ ] Tests unitaires pour `ranking.js`
- [ ] Tests d'intégration pour `apiManager.fetchItinerary()`

**Moyenne priorité :**
- [ ] Cache des résultats Google Routes
- [ ] Métriques de performance
- [ ] Mode hors-ligne amélioré

**Basse priorité :**
- [ ] Continuer refactorisation main.js
- [ ] TypeScript
- [ ] Documentation JSDoc complète

---

## Contact & Maintenance

- **Repository** : https://github.com/EFFEZFEZ/p-rimap-sans-api-
- **Production** : https://périmap.fr (Vercel)

---

*Documentation générée le 6 décembre 2025 - Version V221*
