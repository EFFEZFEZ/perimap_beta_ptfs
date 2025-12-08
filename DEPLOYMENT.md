# Déploiement Backend Auto-hébergé

## Architecture

- **Backend Express** (port 8080) : Sert les fichiers statiques + API proxy
- **OpenTripPlanner** (port interne 8080) : Calcul d'itinéraires multimodaux
- **Photon** : Géocodage via API publique (https://photon.komoot.io)

## Améliorations v2

### 1. Health Checks OTP
Le conteneur OTP prend 60-90 secondes pour construire son graphe. Le healthcheck garantit que l'API attend qu'OTP soit prêt :

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/otp/routers/default"]
  interval: 10s
  timeout: 5s
  retries: 20
  start_period: 60s
```

### 2. Logging Amélioré
Les erreurs de connexion OTP sont maintenant détaillées :
- URL OTP complète
- Code d'erreur (ECONNREFUSED, ENOTFOUND, etc.)
- Stack trace

### 3. Géolocalisation Limitée à la Dordogne
Les autosuggestions Photon filtrent les résultats pour ne garder que :
- Points dans les limites géographiques de la Dordogne (44.69-45.68 N, 0.01-1.54 E)
- Résultats mentionnant "Dordogne" ou "Périgueux"

## Prérequis Data

Placez dans `data/otp/graphs/default/` :
- `gtfs.zip` : Données GTFS du réseau Péribus
- `aquitaine-251206.osm.pbf` : Extrait OpenStreetMap de l'Aquitaine

## Lancement

```bash
# Construire et lancer (attendre 60-90s pour OTP)
docker compose up -d --build

# Vérifier l'état d'OTP
docker compose ps
# Attendre que otp soit "healthy"

# Logs en temps réel
docker compose logs -f api
docker compose logs -f otp

# Tester l'API
curl http://localhost:8080/health
curl "http://localhost:8080/api/places/autocomplete?q=perigueux"
```

## Debugging

Si erreur 502 "Routes proxy error" :

1. Vérifier qu'OTP est healthy :
   ```bash
   docker compose ps otp
   # Doit afficher "(healthy)"
   ```

2. Vérifier les logs OTP :
   ```bash
   docker logs perimap-otp --tail 50
   # Chercher "Graph loaded" ou "Serving"
   ```

3. Tester OTP directement :
   ```bash
   curl http://localhost:8888/otp/routers/default
   ```

4. Vérifier les logs API pour voir l'URL exacte et l'erreur :
   ```bash
   docker logs perimap-api --tail 50
   # Chercher "[routes] OTP proxy error - URL:"
   ```

## Variables d'Environnement

- `OTP_BASE_URL` : URL interne d'OTP (défaut: `http://otp:8080/otp/routers/default`)
- `PHOTON_BASE_URL` : URL de Photon (défaut: `https://photon.komoot.io`)
- `GTFS_RT_URL` : URL du flux GTFS-RT (optionnel, pour temps réel)
- `CORS_ORIGINS` : Origines autorisées (défaut: `http://localhost:8080,http://localhost:3000`)

## Limites Géographiques

Autosuggestions limitées à la Dordogne :
- **Sud** : 44.69°N
- **Nord** : 45.68°N
- **Ouest** : 0.01°E
- **Est** : 1.54°E
- **Centre** (Périgueux) : 45.184°N, 0.716°E
