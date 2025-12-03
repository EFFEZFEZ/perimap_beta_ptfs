<p align="center">
  <img src="https://i.ibb.co/99PZh9Zq/export6-removebg-preview.webp" alt="Périmap Logo" width="120" height="120">
</p>

<h1 align="center">Périmap</h1>

<p align="center">
  <strong>L'application moderne pour les transports en commun de Périgueux</strong>
</p>

<p align="center">
  <a href="https://perimap.fr">perimap.fr</a> •
  <a href="https://instagram.com/perimap.fr">Instagram</a> •
  <a href="https://facebook.com/perimap.fr">Facebook</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.13.0-22c55e?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/PWA-Ready-00c8ff?style=flat-square" alt="PWA">
  <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="License">
</p>

---

## À propos

**Périmap** est une application web progressive (PWA) gratuite et indépendante qui simplifie les déplacements en transports en commun dans le Grand Périgueux. Elle offre une alternative moderne à l'application officielle Péribus avec une interface épurée et des fonctionnalités avancées.

### Fonctionnalités principales

| Fonctionnalité | Description |
|----------------|-------------|
| **Carte interactive** | Visualisez les lignes et arrêts sur une carte Leaflet |
| **Bus en temps réel** | Suivez la position des bus en direct |
| **Calcul d'itinéraire** | Trouvez le meilleur trajet (bus, marche, vélo) |
| **Horaires GTFS** | Consultez les horaires de tous les arrêts |
| **Mode sombre** | Interface adaptée à vos préférences |
| **Hors-ligne** | Fonctionne même sans connexion internet |
| **Installable** | Ajoutez l'app sur votre écran d'accueil |

---

## Identité visuelle

### Couleurs officielles

<table>
  <tr>
    <td align="center" width="200">
      <div style="background: #22c55e; width: 60px; height: 60px; border-radius: 12px; margin: 0 auto;"></div>
      <br>
      <strong>Vert Périmap</strong><br>
      <code>#22c55e</code><br>
      <em>Couleur primaire</em>
    </td>
    <td align="center" width="200">
      <div style="background: #00c8ff; width: 60px; height: 60px; border-radius: 12px; margin: 0 auto;"></div>
      <br>
      <strong>Cyan</strong><br>
      <code>#00c8ff</code><br>
      <em>Couleur secondaire</em>
    </td>
    <td align="center" width="200">
      <div style="background: linear-gradient(135deg, #22c55e, #00c8ff); width: 60px; height: 60px; border-radius: 12px; margin: 0 auto;"></div>
      <br>
      <strong>Gradient</strong><br>
      <code>#22c55e → #00c8ff</code><br>
      <em>Signature</em>
    </td>
  </tr>
</table>

### Palette complète

```css
/* Couleurs principales */
--pm-green: #22c55e;          /* Primaire - CTA, liens actifs */
--pm-green-hover: #16a34a;    /* Hover primaire */
--pm-cyan: #00c8ff;           /* Secondaire - Highlights */
--pm-cyan-hover: #0ea5e9;     /* Hover secondaire */

/* Gradient signature */
--pm-gradient: linear-gradient(135deg, #22c55e 0%, #00c8ff 100%);

/* Light Mode */
--pm-bg-page: #f8fafc;        /* Fond de page */
--pm-bg-card: #ffffff;        /* Cartes */
--pm-text-primary: #0f172a;   /* Texte principal */
--pm-text-secondary: #64748b; /* Texte secondaire */
--pm-border: #e2e8f0;         /* Bordures */

/* Dark Mode */
--pm-bg-page: #0b1220;        /* Fond de page */
--pm-bg-card: #0f1724;        /* Cartes */
--pm-text-primary: #e6eef8;   /* Texte principal */
--pm-text-secondary: #9fb3c9; /* Texte secondaire */
--pm-border: rgba(255,255,255,0.08);
```

### Typographie

| Élément | Police | Poids | Taille |
|---------|--------|-------|--------|
| **H1** | Manrope | 800 (ExtraBold) | 2.5rem (40px) |
| **H2** | Manrope | 700 (Bold) | 2rem (32px) |
| **H3** | Manrope | 600 (SemiBold) | 1.5rem (24px) |
| **Body** | Manrope | 400 (Regular) | 1rem (16px) |
| **Small** | Manrope | 400 (Regular) | 0.875rem (14px) |

**Fallback** : `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

### Rayons de bordure

| Usage | Valeur |
|-------|--------|
| Boutons | 8px |
| Cartes | 16px |
| Modales | 24px |
| Pills/Badges | 9999px (circulaire) |

### Animations

| Type | Durée | Easing |
|------|-------|--------|
| Rapide (hover) | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Normal | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Lent (modales) | 350ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Bounce | 500ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

---

## Architecture technique

### Stack technologique

| Catégorie | Technologies |
|-----------|--------------|
| **Frontend** | HTML5, CSS3, JavaScript ES6+ (Vanilla) |
| **Carte** | Leaflet.js, OpenStreetMap, CARTO |
| **APIs** | Google Places, Google Routes |
| **Données** | GTFS Péribus (statique) |
| **PWA** | Service Worker, IndexedDB, Cache API |
| **Hébergement** | Vercel |
| **Domaine** | One.com |

### Structure du projet

```
perimap/
├── public/
│   ├── index.html              # Page principale (SPA)
│   ├── about.html              # À propos + Admin
│   ├── mentions-legales.html   # Mentions légales
│   ├── style.css               # Styles principaux (~10K lignes)
│   ├── manifest.json           # Manifest PWA
│   ├── service-worker.js       # Cache & offline
│   │
│   ├── css/
│   │   └── brand.css           # 🎨 Charte graphique
│   │
│   ├── js/
│   │   ├── app.js              # Point d'entrée
│   │   ├── main.js             # Logique principale
│   │   ├── config.js           # Configuration runtime
│   │   ├── dataManager.js      # Gestion données GTFS
│   │   ├── mapRenderer.js      # Rendu carte Leaflet
│   │   ├── apiManager.js       # APIs Google
│   │   ├── timeManager.js      # Gestion temps
│   │   ├── tripScheduler.js    # Calcul positions bus
│   │   ├── uiManager.js        # UI & thèmes
│   │   ├── geolocationManager.js
│   │   │
│   │   ├── config/             # Configuration statique
│   │   ├── controllers/        # Contrôleurs vues
│   │   ├── ui/                 # Composants UI
│   │   ├── utils/              # Utilitaires
│   │   └── workers/            # Web Workers
│   │
│   ├── views/                  # Templates HTML
│   │   ├── carte.html
│   │   ├── hall.html
│   │   ├── horaires.html
│   │   ├── itineraire.html
│   │   ├── trafic.html
│   │   └── tarifs-*.html
│   │
│   ├── data/
│   │   ├── gtfs/               # Données GTFS Péribus
│   │   ├── map.geojson         # Tracés des lignes
│   │   └── line-status.json    # État du trafic
│   │
│   └── icons/                  # Icônes PWA
│
├── scripts/
│   └── preprocess-gtfs.mjs     # Prétraitement GTFS
│
└── README.md                   # Ce fichier
```

### Modules JavaScript

| Module | Responsabilité |
|--------|----------------|
| `app.js` | Initialisation, chargement GTFS |
| `main.js` | Logique métier principale |
| `dataManager.js` | Indexation et accès données GTFS |
| `mapRenderer.js` | Affichage carte, markers, polylines |
| `apiManager.js` | Appels Google Places/Routes |
| `timeManager.js` | Gestion temps réel/simulé |
| `tripScheduler.js` | Calcul positions des bus |
| `uiManager.js` | Thème dark/light, préférences |
| `geolocationManager.js` | Géolocalisation utilisateur |

---

## Installation & Développement

### Prérequis

- Serveur HTTP local (VS Code Live Server, Python, etc.)
- Navigateur moderne (Chrome, Firefox, Safari, Edge)

### Lancement local

```bash
# Cloner le repo
git clone https://github.com/EFFEZFEZ/p-rimap-sans-api-.git
cd p-rimap-sans-api-

# Lancer avec Live Server (VS Code)
# Ou avec Python :
python -m http.server 8080 --directory public

# Ouvrir http://localhost:8080
```

### Mise à jour des données GTFS

```bash
# Option 1 : Node.js
node scripts/preprocess-gtfs.mjs

# Option 2 : PowerShell
# (voir README technique)
```

---

## PWA & Installation

Périmap est une **Progressive Web App** installable :

1. Ouvrir [perimap.fr](https://perimap.fr) dans votre navigateur
2. **iOS** : Safari → Partager → "Sur l'écran d'accueil"
3. **Android** : Chrome → Menu → "Installer l'application"
4. **Desktop** : Chrome → Barre d'adresse → Icône d'installation

### Fonctionnalités PWA

- ✅ Installable sur l'écran d'accueil
- ✅ Fonctionne hors-ligne (horaires cachés)
- ✅ Raccourcis rapides (Itinéraire, Horaires, Carte, Trafic)
- ✅ Thème adapté au système

---

## Données utilisées

### GTFS Péribus

Les données de transport proviennent du **GTFS officiel du réseau Péribus** :

| Fichier | Contenu |
|---------|---------|
| `routes.txt` | Définition des lignes (A, B, C, D...) |
| `trips.txt` | Courses avec direction |
| `stops.txt` | Arrêts avec coordonnées |
| `stop_times.txt` | Horaires de passage |
| `calendar.txt` | Jours de service |
| `shapes.txt` | Tracés géométriques |

### Lignes du réseau

| Ligne | Terminus | Couleur |
|-------|----------|---------|
| **A** | Boulazac ↔ Campus | Rouge |
| **B** | Champcevinel ↔ Trélissac | Bleu |
| **C** | Auchan ↔ Boulazac | Vert |
| **D** | Gare ↔ Coulounieix | Orange |
| **E-H** | Lignes complémentaires | Diverses |
| **N** | Service de nuit | Violet |
| **TAD** | Transport à la demande | Gris |

---

## Confidentialité & Mentions légales

### Données personnelles

- ❌ **Aucune collecte** de données personnelles
- ❌ **Aucun cookie** publicitaire ou de tracking
- ❌ **Aucun outil** d'analyse tiers
- ✅ Géolocalisation utilisée **uniquement localement**
- ✅ Préférences stockées en **localStorage**

### Informations légales

- **Éditeur** : Projet personnel à but non lucratif
- **Hébergeur** : Vercel Inc. (USA)
- **Domaine** : One.com Group AB
- **Contact** : perimapfr@gmail.com

[Voir les mentions légales complètes](https://perimap.fr/mentions-legales.html)

---

## Contribution

Ce projet est open-source ! Contributions bienvenues :

1. **Fork** le repository
2. Créer une branche (`git checkout -b feature/ma-feature`)
3. **Commit** (`git commit -m 'Add ma feature'`)
4. **Push** (`git push origin feature/ma-feature`)
5. Ouvrir une **Pull Request**

### Signaler un bug

Ouvrir une [Issue GitHub](https://github.com/EFFEZFEZ/p-rimap-sans-api-/issues) avec :
- Description du problème
- Étapes pour reproduire
- Navigateur et version
- Screenshots si possible

---

## Licence

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## Remerciements

- **Péribus / Grand Périgueux** pour les données GTFS publiques
- **OpenStreetMap** pour les fonds de carte
- **Google** pour les APIs Places et Routes
- La communauté open-source pour les outils utilisés

---

<p align="center">
  <strong>Fait avec soin pour les usagers du Grand Périgueux</strong>
</p>

<p align="center">
  <a href="https://perimap.fr">perimap.fr</a>
</p>

---

## Roadmap de développement

### En cours (v128+)

| Priorité | Tâche | Statut |
|----------|-------|--------|
| Haute | Notifications push perturbations | Planifié |
| Haute | Favoris arrêts/lignes | Planifié |
| Moyenne | Widget iOS/Android | Recherche |
| Moyenne | Intégration calendrier | Planifié |

### Court terme (Q1 2025)

- [ ] **Alertes personnalisées** : Notifications push pour vos lignes favorites
- [ ] **Favoris** : Sauvegarder vos arrêts et trajets fréquents
- [ ] **Historique** : Retrouver vos dernières recherches
- [ ] **Partage d'itinéraire** : Envoyer un trajet par lien

### Moyen terme (Q2 2025)

- [ ] **Temps réel avancé** : Intégration API SIRI si disponible
- [ ] **Accessibilité PMR** : Filtres et infos accessibilité
- [ ] **Multi-langue** : Support anglais/espagnol
- [ ] **Statistiques** : Tableau de bord personnel (km parcourus, CO2 économisé)

### Long terme (2025+)

- [ ] **Application native** : React Native ou Flutter
- [ ] **Crowdsourcing** : Signalement perturbations par les usagers
- [ ] **Gamification** : Badges et récompenses fidélité
- [ ] **Extension réseau** : Support d'autres réseaux Nouvelle-Aquitaine

### Idées en discussion

| Idée | Faisabilité | Impact |
|------|-------------|--------|
| Mode AR (réalité augmentée) | Complexe | Wow effect |
| Chatbot assistant | Moyen | Utile |
| Apple Watch / Wear OS | Moyen | Niche |
| Intégration Citymapper | Facile | Visibilité |

### Contribution

Vous avez une idée ? Ouvrez une [Issue GitHub](https://github.com/EFFEZFEZ/p-rimap-sans-api-/issues) !

Les contributions sont les bienvenues via Pull Request.


