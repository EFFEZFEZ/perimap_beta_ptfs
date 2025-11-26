## Péribus - Console Temps Réel

Ce dépôt contient la console web temps réel du réseau Péribus (Grand Périgueux). L'application charge les données GTFS en local, applique un routage hybride et affiche les bus en direct sur une carte Leaflet.

### Prétraitement des données GTFS

Le chargement du navigateur repose désormais sur un bundle optimisé (`public/data/gtfs/gtfs.bundle.json`) et sur sa version compressée (`gtfs.bundle.json.gz`). La version gzip est la seule à devoir être commitée (elle reste < 50 MB). Les scripts de prétraitement régénèrent automatiquement les deux fichiers à chaque mise à jour des fichiers `*.txt` fournis par l'AO, y compris `shapes.txt` pour les géométries.

#### Option 1 – Node.js (script dédié)

```
node scripts/preprocess-gtfs.mjs
```

Le script lit les fichiers CSV présents dans `public/data/gtfs`, nettoie les valeurs puis écrit `gtfs.bundle.json`.

#### Option 2 – PowerShell natif (pas de dépendance)

```
$base = "c:/Users/<vous>/Peribus Test design/public/data"
$gtfs = Join-Path $base 'gtfs'
$files = 'routes','trips','stop_times','stops','calendar','calendar_dates','shapes'
$bundle = [ordered]@{}
foreach ($name in $files) {
	$bundle[$name -replace 'calendar_dates','calendarDates' -replace 'stop_times','stopTimes'] = Import-Csv (Join-Path $gtfs ("$name.txt"))
}
$bundle['geoJson'] = (Get-Content (Join-Path $base 'map.geojson') -Raw | ConvertFrom-Json)
$bundle | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $gtfs 'gtfs.bundle.json') -Encoding UTF8
gzip -k public/data/gtfs/gtfs.bundle.json
```

### Chargement côté client

- `public/js/workers/gtfsWorker.js` charge le bundle (ou relit les CSV en fallback) dans un Web Worker, construit les index GTFS puis transfère le résultat au `DataManager`.
- `public/js/utils/gtfsProcessor.js` centralise le nettoyage et la génération des index (`routesById`, `stopsByName`, `stopTimesByTrip`, etc.).

### Lancer l'application

Ouvrir `public/index.html` avec un serveur statique (Live Server VS Code par exemple). La console affichera la progression du chargement GTFS et la carte deviendra interactive une fois les données prêtes.

### Étapes suivantes

- Refactoring complet de `main.js` (UIManager, Router, Geolocation Manager).
- Ajout d'un manifest PWA + Service Worker pour le fonctionnement hors ligne.

### Architecture (Refactor 2025)

La base historique contenait une logique très dense dans `public/js/main.js`. Un refactor progressif a extrait les responsabilités suivantes:

| Module | Rôle | Points clés |
|--------|------|-------------|
| `public/js/config.js` | Configuration runtime | Récupère la clé Google (`googleApiKey`) via 3 priorités: `window.__APP_CONFIG`, balise `<meta name="peribus-api-key">`, variable d'environnement `PERIBUS_GOOGLE_API_KEY`. Jamais de clé hardcodée dans le code après refactor. |
| `public/js/itinerary/ranking.js` | Déduplication + tri mode "arriver" | Fonctions `deduplicateItineraries(list)` et `rankArrivalItineraries(itins, searchTime)` appliquent un ordre déterministe: heure d'arrivée, transferts, durée de marche, durée brute. Gère la pagination (stockée dans `main.js`). |
| `public/js/ui/resultsRenderer.js` | Rendu liste d'itinéraires | Remplace l'ancienne fonction `renderItineraryResults`. Gère regroupement (BUS/VÉLO/PIÉTON) en mode départ, pagination + bouton "Charger plus" en mode arrivée. Injection d'un callback `onSelectItinerary` pour la carte et le panneau détail. |
| `public/js/utils/geo.js` | Utilitaires géographiques | Normalisation de nom d'arrêt + résolution coordonnées (cache) sans refaire la logique complète du DataManager. |
| `public/js/constants.js` | (Optionnel) Regroupement de constantes | Peut stocker icônes et tailles de niveau de bottom sheet. Dans l'option A retenue ici, les icônes restent locales à `main.js` pour limiter le diff. |

#### Flux de recherche d'itinéraires
1. Saisie utilisateur (départ / arrivée) → `executeItinerarySearch`.
2. Récupération des coordonnées Google (place_id) via `ApiManager`.
3. Tentative d'itinéraire hybride (GTFS + Google) via `RouterWorkerClient` ou fallback routeur principal.
4. Fallback pur Google Transit si aucun hybride.
5. Post-traitements: assurance des polylines, filtrage des itinéraires expirés, déduplication + tri si mode "arriver".
6. Initialisation des onglets via `setupResultTabs` puis rendu via `resultsRenderer.render('ALL')`.

#### Pagination mode "arriver"
Variables globales dans `main.js`:
`arrivalRankedAll` (liste complète triée), `arrivalRenderedCount` (compteur actuel), `ARRIVAL_PAGE_SIZE` (taille page configurable via `config.js`). Le bouton "Charger plus" incrémente le compteur jusqu'à saturation de la liste.

#### Fournir la clé API Google
Avant chargement des scripts, définir soit:
```html
<meta name="peribus-api-key" content="VOTRE_CLE_RESTREE">
```
ou
```html
<script>
	window.__APP_CONFIG = { googleApiKey: 'VOTRE_CLE_RESTREE' };
</script>
```
Sans clé (vide), les fonctionnalités dépendantes (Places / Directions / Transit temps réel) renvoient des warnings et les itinéraires hybrides tombent en mode dégradé.

#### Migration / Intégration
Pour ajouter un nouveau critère de tri mode "arriver": étendre le tableau `scored` dans `ranking.js` puis ajuster la fonction `sort`. Garder l'ordre de priorité (heure arrivée → transferts → marche → durée brute) pour lisibilité. Pour un nouveau type d'itinéraire (ex: TROTTINETTE), ajouter le mapping dans `resultsRenderer.getItineraryType` et le regroupement dans la logique de buckets.

#### Avantages obtenus
- Plus de clé sensible hardcodée.
- Rendu découplé: facilite test visuel / optimisation future (virtualisation, diffing DOM).
- Tri deterministic mode "arriver" (plus de résultats aléatoires).
- Pagination progressive pour limiter surcharge visuelle.
- Modules ciblés aidant l'onboarding (geo, ranking, config).

#### Prochaines pistes
- Documenter l'API interne `RouterWorkerClient`.
- Extraire logique de détail itinéraire (HTML) dans un module dédié.
- Ajouter tests unitaires rapides (signature déduplication, tri).


