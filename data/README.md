# Données externes

Place ici les données nécessaires pour OTP et Photon.

## OTP (routage)
- Dossier: `data/otp/`
- Fichiers attendus:
  - `aquitaine-latest.osm.pbf` (ou un extrait OSM Geofabrik adapté)
  - `gtfs.zip` (GTFS Péribus le plus récent)

## Photon (autocomplétion)
- Dossier: `data/photon/`
- Fichiers attendus:
  - `aquitaine-latest.osm.pbf` (même fichier OSM que pour OTP)

Après avoir copié ces fichiers, lance:
```
docker compose up -d
```
(Le premier démarrage OTP peut prendre quelques minutes le temps de construire le graphe.)
