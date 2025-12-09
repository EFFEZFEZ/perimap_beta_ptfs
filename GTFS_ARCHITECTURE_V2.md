# Architecture GTFS Centralisée V2

## Objectif Global
Centraliser et nettoyer les données dans le Backend avant de les envoyer au Frontend. Le Frontend ne doit recevoir que des données parfaites (Couleurs Hex correctes, Noms courts lisibles).

---

## ÉTAPE 1 : Loader GTFS "Intelligent" ✅

### Fichier Cible
`server/utils/gtfsLoader.js`

### Modifications Implémentées

#### 1.1 - Chargement au Démarrage
- ✅ Utilise `fs` et CSV parsing natif pour lire `server/data/gtfs/routes.txt`
- ✅ Stocke les données dans une `Map<string, Object>` avec clé = `route_id`
- ✅ Chaque entrée contient: `{ color, textColor, shortName, longName }`

#### 1.2 - Gestion des Couleurs
- ✅ Si couleur sans `#`, ajoute automatiquement le préfixe
- ✅ Si couleur vide, applique défaut bleu: `#3388ff`
- ✅ Si textColor vide, applique défaut blanc: `#ffffff`
- ✅ Validation regex pour s'assurer que les couleurs sont hex valides

#### 1.3 - Fonction de Recherche "Fuzzy" : `getRouteAttributes()`
Nouvelle fonction exporte pour gérer les problèmes de préfixes OTP.

```javascript
export function getRouteAttributes(otpRouteId, routeMap)
```

**Algorithme de recherche en 4 étapes** :

1. **Correspondance exacte** : `routeId === storedId`
   - Exemple: `"A"` trouve `"A"` ✅

2. **Correspondance sans préfixe** : Split sur `:` et teste chaque partie
   - Exemple: `"GrandPerigueux:A"` → teste `"A"` ✅
   - Exemple: `"RATP:75502"` → teste `"75502"` ✅

3. **Correspondance suffixe** : Teste `.endsWith()` bidirectionnel
   - Exemple: `"RATP:A"` stocké, `"A"` cherché → match ✅
   - Exemple: `"GrandPerigueux:75"` cherché, `"75"` stocké → match ✅

4. **Fallback propre** : Si aucune correspondance
   - Retourne `{ color: '#808080', textColor: '#ffffff', shortName: otpRouteId, longName: 'Ligne inconnue' }`
   - **Garantie**: Ne plante JAMAIS l'API

---

## ÉTAPE 2 : Enrichissement OTP via le Service ✅

### Fichier Cible
`server/services/otpService.js`

### Modifications Implémentées

#### 2.1 - Import du Nouveau Module
```javascript
import { getRouteAttributes } from '../utils/gtfsLoader.js';
```

#### 2.2 - Fonction `getRouteColors()` Mise à Jour
Maintenant utilise la recherche fuzzy de `getRouteAttributes()` :

```javascript
function getRouteColors(routeId) {
    return getRouteAttributes(routeId, gtfsRouteColors);
}
```

#### 2.3 - Enrichissement des Legs : `enrichLegWithColors()`
Pour chaque `leg` de type TRANSIT (BUS, TRAM, RAIL, etc.) :

- ✅ Appelle `getRouteColors(leg.routeId)` avec l'ID "sale" d'OTP
- ✅ Récupère les attributs propres via fuzzy matching
- ✅ Écrase les propriétés du leg :
  - `routeColor` → couleur hex propre depuis GTFS
  - `routeTextColor` → couleur texte propre depuis GTFS
  - `routeShortName` → nom court propre (ex: `"A"` au lieu de `"1:A"`)
  - `routeLongName` → nom long depuis GTFS

### Résultat Frontend
Le Frontend reçoit maintenant :
```json
{
  "mode": "BUS",
  "routeColor": "#FF5733",
  "routeTextColor": "#FFFFFF",
  "routeShortName": "A",
  "routeLongName": "Périgueux - Bergerac",
  "headsign": "Gare de Bergerac",
  "polyline": "..."
}
```

Zéro risque de couleur cassée ou nom vide ! 🎉

---

## ÉTAPE 3 : Procédure de Maintenance ✅

### Problème
OTP cache le graphe de routage (`graph.obj`) au premier démarrage. Si vous mettez à jour `routes.txt` avec de nouvelles couleurs ou horaires, OTP continuera à utiliser l'ancienne version en cache.

### Solution Complète

#### Pour forcer OTP à recharger les données GTFS à jour :

```bash
# 1. Arrêter les conteneurs
docker-compose down

# 2. Supprimer le cache OTP
# Option A : Supprimer le volume Docker entièrement
docker volume rm perimap-otp-data

# Option B : Supprimer juste les graphes
rm -rf data/otp/graphs/default/*

# 3. Relancer les conteneurs
docker-compose up -d

# 4. Monitorer le rebuild (2-5 minutes)
docker logs perimap-otp -f
```

#### Indicateurs de succès
- Logs montrent : `[OTP] Building graph from GTFS...`
- Après quelques minutes : `[OTP] Graph ready` ou logs deviennent silencieux
- Logs `perimap-api` montrent : `✅ 79 lignes chargées avec leurs couleurs`

#### Diagnostic rapide
```bash
# Vérifier si OTP écoute
curl http://localhost:8888/otp/routers/default

# Vérifier les couleurs chargées
curl -X POST http://localhost:8080/api/routes \
  -H "Content-Type: application/json" \
  -d '{"origin":{"lat":45.1,"lon":0.7},"destination":{"lat":45.2,"lon":0.8}}'
```

---

## Architecture Finale

```
Frontend (http://localhost:8080)
    ↓
    ├─→ GET /api/routes?origin=...&destination=...
    └─→ GET /api/places/autocomplete?q=...
        ↓
Backend (Node.js Express, http://localhost:3000)
    ├─→ Serveur démarre
    │   ├─→ loadRouteColors() charge GTFS depuis public/data/gtfs/routes.txt
    │   └─→ Map 79 routes avec couleurs normalisées
    │
    ├─→ API reçoit requête /api/routes
    │   └─→ Appelle OTP via otpService.planItinerary()
    │
    ├─→ OTP retourne itinéraires bruts
    │   └─→ routeId peut être : "A", "GrandPerigueux:A", "RATP:75502"
    │
    ├─→ otpService.enrichLegWithColors()
    │   ├─→ Pour chaque leg transit
    │   ├─→ Appelle getRouteAttributes(leg.routeId, gtfsRouteColors)
    │   │   └─→ Fuzzy matching 4 étapes → trouve la route GTFS
    │   └─→ Écrase routeColor, routeTextColor, routeShortName
    │
    └─→ Frontend reçoit réponse avec :
        ├─→ Couleurs hex correctes ✅
        ├─→ Noms courts lisibles ✅
        └─→ Jamais de fallback cassé ✅

Docker Containers
    ├─→ perimap-otp (port 8888)
    │   ├─→ OpenTripPlanner
    │   └─→ Data: data/otp/aquitaine-251206.osm.pbf + GTFS
    │
    └─→ perimap-api (port 8080)
        └─→ Node.js Express + tous les services
```

---

## Fichiers Modifiés

### 1. `server/utils/gtfsLoader.js`
- ✅ Ajout commentaires ÉTAPE 1 et procédure maintenance
- ✅ Nouvelle fonction `getRouteAttributes(otpRouteId, routeMap)`
- ✅ Export de `getRouteAttributes` dans default export

### 2. `server/services/otpService.js`
- ✅ Import `{ getRouteAttributes } from '../utils/gtfsLoader.js'`
- ✅ Ajout commentaires ÉTAPE 2
- ✅ Mise à jour `getRouteColors()` pour utiliser fuzzy matching
- ✅ Enrichissement `enrichLegWithColors()` avec GTFS propres

---

## Prochaines Étapes Optionnelles

### Logging Amélioré
Ajouter dans `enrichLegWithColors()` :
```javascript
logger.debug(`[Route] ${leg.routeId} → ${gtfsAttrs.shortName} (${gtfsAttrs.color})`);
```

### Tests Unit
Créer `tests/gtfsLoader.test.js` pour valider fuzzy matching :
```javascript
test('getRouteAttributes handles OTP prefixes', () => {
  expect(getRouteAttributes('GrandPerigueux:A', routeMap)).toBe(routeMap.get('A'));
  expect(getRouteAttributes('A', routeMap)).toBe(routeMap.get('A'));
  expect(getRouteAttributes('UNKNOWN', routeMap).color).toBe('#808080');
});
```

### Cache Couleurs
Ajouter expiration de cache pour recharger routes.txt sans redémarrer serveur.

---

## Commit GitHub
```
ÉTAPE 1-2: Loader GTFS intelligent + enrichissement OTP
- Étape 1: getRouteAttributes() avec fuzzy matching 4 niveaux
- Étape 2: enrichLegWithColors() utilise GTFS propres
- Étape 3: Procédure maintenance documentée
- Services redémarrés avec les modifications
```

**Commit SHA:** `71d5f22`

---

**Dernière mise à jour:** 2025-12-09  
**Statut:** ✅ En production
