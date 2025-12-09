# Guide Développeur : Loader GTFS Intelligent

## 🎯 Objectif
Vous avez implementé une architecture GTFS centralisée qui :
1. ✅ Charge `routes.txt` au démarrage du serveur
2. ✅ Nettoie les couleurs hex (normalisation, defaults)
3. ✅ Fournit une recherche fuzzy pour gérer les variations d'IDs OTP
4. ✅ Enrichit chaque trajet avec les bonnes couleurs/noms

## 📚 Architecture

### Flux de Données
```
routes.txt (GTFS brut)
    ↓ loadRouteColors()
Map<route_id, { color, textColor, shortName, longName }>
    ↓ initOtpService()
gtfsRouteColors (cache en mémoire)
    ↓ enrichLegWithColors() + getRouteAttributes()
Frontend (données propres)
```

## 🔧 API Principale

### `getRouteAttributes(otpRouteId, routeMap)`

**Description** : Récupère les attributs d'une ligne depuis GTFS avec fuzzy matching.

**Paramètres**:
- `otpRouteId` (string) : ID venant d'OTP, peut avoir des préfixes
- `routeMap` (Map) : Données GTFS chargées au démarrage

**Retour**:
```javascript
{
  color: '#FF5733',           // Couleur hex propre
  textColor: '#FFFFFF',       // Couleur texte propre
  shortName: 'A',             // Nom court (ex: "A", "75")
  longName: 'Périgueux - Bergerac'  // Nom long
}
```

**Algorithme de Matching** (4 étapes, dans l'ordre) :

#### Étape 1 : Correspondance Exacte
```javascript
// Input: "A"
// routeMap contient: "A" → { color: '#FF5733', ... }
// Result: Direct match ✅
```

#### Étape 2 : Correspondance sans Préfixe (Split)
```javascript
// Input: "GrandPerigueux:A"
// routeMap contient: "A" → { color: '#FF5733', ... }
// Split sur ':' → ['GrandPerigueux', 'A']
// Teste 'A' → Match ✅

// Input: "RATP:75:502"
// Split → ['RATP', '75', '502']
// Teste chaque partie jusqu'à match
```

#### Étape 3 : Correspondance Suffixe Bidirectionnelle
```javascript
// Cas 1: stocké finit par cherché
// Input: "A"
// routeMap contient: "RATP:A" → { ... }
// "RATP:A".endsWith("A") → Match ✅

// Cas 2: cherché finit par stocké
// Input: "GrandPerigueux:75"
// routeMap contient: "75" → { ... }
// "GrandPerigueux:75".endsWith("75") → Match ✅
```

#### Étape 4 : Fallback Propre
```javascript
// Input: "UNKNOWN_ROUTE_ID"
// Aucune correspondance
// Return: {
//   color: '#808080',           // Gris neutre
//   textColor: '#ffffff',
//   shortName: 'UNKNOWN_ROUTE_ID',  // L'ID qu'on cherchait
//   longName: 'Ligne inconnue'
// }
// → L'API ne plante JAMAIS ✅
```

## 📋 Exemples d'Utilisation

### Exemple 1 : Test Simple dans Node.js REPL
```javascript
import { getRouteAttributes } from './server/utils/gtfsLoader.js';

const routeMap = new Map([
  ['A', { color: '#FF5733', textColor: '#FFFFFF', shortName: 'A', longName: 'Périgueux - Bergerac' }],
  ['75', { color: '#0066FF', textColor: '#FFFFFF', shortName: '75', longName: 'Périgueux - Agen' }],
]);

// Test 1: Correspondance exacte
console.log(getRouteAttributes('A', routeMap));
// { color: '#FF5733', textColor: '#FFFFFF', shortName: 'A', longName: 'Périgueux - Bergerac' }

// Test 2: Avec préfixe OTP
console.log(getRouteAttributes('GrandPerigueux:A', routeMap));
// { color: '#FF5733', ... } (fuzzy matching fonctionne!)

// Test 3: ID inexistant (fallback)
console.log(getRouteAttributes('UNKNOWN', routeMap));
// { color: '#808080', textColor: '#FFFFFF', shortName: 'UNKNOWN', longName: 'Ligne inconnue' }
```

### Exemple 2 : Requête API Réelle
```bash
# Requête itinéraire au backend
curl -X POST http://localhost:8080/api/routes \
  -H "Content-Type: application/json" \
  -d '{
    "origin": {"lat": 45.18, "lon": 0.71},
    "destination": {"lat": 45.20, "lon": 0.75},
    "time": "2025-12-09T10:00:00Z"
  }'

# Réponse (simplified)
{
  "routes": [
    {
      "type": "TRANSIT",
      "duration": 1800,
      "legs": [
        {
          "mode": "BUS",
          "routeId": "GrandPerigueux:A",        // ID OTP brut
          "routeColor": "#FF5733",               // ← Depuis GTFS via fuzzy matching!
          "routeTextColor": "#FFFFFF",           // ← Depuis GTFS
          "routeShortName": "A",                 // ← Depuis GTFS (pas de préfixe!)
          "routeLongName": "Périgueux - Bergerac",  // ← Depuis GTFS
          "headsign": "Gare de Bergerac",
          "polyline": "..."
        },
        {
          "mode": "WALK",
          "duration": 300,
          "distanceMeters": 250
        }
      ]
    }
  ]
}
```

## 🐛 Débogage

### Vérifier que GTFS est chargé
```bash
# Dans les logs serveur au démarrage
docker logs perimap-api | grep "lignes chargées"
# Output: "✅ 79 lignes chargées avec leurs couleurs"
```

### Activer les logs de debugging
```javascript
// Dans otpService.js, à la ligne 75 :
logger.debug(`[Route] ${leg.routeId} → ${gtfsAttrs.shortName} (${gtfsAttrs.color})`);

// Relancer avec LOG_LEVEL=debug
docker-compose down
LOG_LEVEL=debug docker-compose up -d perimap-api
docker logs perimap-api -f
```

### Tester getRouteAttributes manuellement
```bash
# Créer un fichier test.mjs
import { getRouteAttributes } from './server/utils/gtfsLoader.js';
import { loadRouteColors } from './server/utils/gtfsLoader.js';

const routeMap = await loadRouteColors('./public/data/gtfs');
console.log('=== Test fuzzy matching ===');
console.log('Exact match:', getRouteAttributes('A', routeMap));
console.log('With prefix:', getRouteAttributes('GrandPerigueux:A', routeMap));
console.log('Fallback:', getRouteAttributes('UNKNOWN', routeMap));

# Exécuter
cd server && node ../test.mjs
```

## 🎨 Cas d'Usage: Problèmes de Couleurs

### Problème Avant (Sans Fuzzy)
```
OTP dit: routeId = "GrandPerigueux:A"
GTFS a:  route_id = "A"
Result:  getRouteColors("GrandPerigueux:A") → undefined ❌
         Frontend reçoit: routeColor = null, routeTextColor = null
         UI cassée! 🔴
```

### Solution Après (Avec Fuzzy)
```
OTP dit: routeId = "GrandPerigueux:A"
GTFS a:  route_id = "A"
getRouteAttributes("GrandPerigueux:A", routeMap):
  1. Cherche "GrandPerigueux:A" → non trouvé
  2. Split sur ':' → teste "GrandPerigueux" (non trouvé)
  3. Teste "A" → TROUVÉ! ✅
Result:  Frontend reçoit: routeColor = "#FF5733" ✅
```

## 📖 Maintenance GTFS

### Si vous mettez à jour routes.txt
```bash
# 1. Modifier public/data/gtfs/routes.txt
# 2. Forcer OTP à recharger (voir GTFS_ARCHITECTURE_V2.md)
docker-compose down
docker volume rm perimap-otp-data
docker-compose up -d
# 3. Attendre 2-5 minutes pour le rebuild
docker logs perimap-otp -f

# 4. Vérifier que les nouvelles couleurs sont chargées
curl http://localhost:8080/api/health
# Vérifier un trajet complet avec test.mjs
```

### Si fuzzy matching ne trouve pas une ligne
```javascript
// Ajouter du logging temporaire dans getRouteAttributes():
logger.warn(`[Route] Aucune correspondance pour: ${cleanId}`);
logger.warn(`[Route] Clés disponibles dans routeMap:`, Array.from(routeMap.keys()).slice(0, 10));

// Redémarrer et tester à nouveau
docker-compose restart perimap-api
docker logs perimap-api -f
```

## ✅ Checklist de Déploiement

- [ ] `loadRouteColors()` charge routes.txt sans erreur
- [ ] `gtfsRouteColors` contains 79 entrées (ou votre nombre de lignes)
- [ ] `getRouteAttributes('A', gtfsRouteColors)` retourne couleur propre
- [ ] `getRouteAttributes('Unknown:ID', gtfsRouteColors)` retourne fallback gris
- [ ] Une requête `/api/routes` retourne des legs avec `routeColor` défini
- [ ] Les logs ne montrent pas d'erreur "Cannot read property 'color'"
- [ ] Frontend affiche les couleurs correctes sur la carte

## 🔗 Fichiers Importants
- `server/utils/gtfsLoader.js` - Loader + fuzzy matching
- `server/services/otpService.js` - Enrichissement des legs
- `public/data/gtfs/routes.txt` - Données source
- `GTFS_ARCHITECTURE_V2.md` - Documentation complète

---

**Questions?** Consultez les logs avec `docker logs perimap-api -f` ou ajouter des `logger.debug()` dans le code.
