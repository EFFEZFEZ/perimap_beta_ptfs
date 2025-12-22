# Dev roadmap PériMap (2025 → 2026)

Objectif: prioriser les évolutions utiles au quotidien (horaires/itinéraires) et sécuriser la stack auto-hébergée (API + OTP) avec un plan réaliste.

---

## Phase 0 — Maintenant (déjà en place)
- Stack Docker opérationnelle (Express + OTP) + healthchecks.
- Front PWA stable (service worker, UI itinéraires, trafic, GTFS couleurs).
- **Alerte “période horaires” (vacances/fériés/périodes spéciales)** basée sur `calendar.txt` + `calendar_dates.txt`.

Livrable: rappel automatique dans l’écran Horaires, sans configuration manuelle.

---

## Phase 1 — 1 à 2 semaines (qualité horaires & compréhension)
### 1.1 Périodes horaires (UX claire)
- Afficher une info courte et visible quand:
  - il n’y a **aucun service** (calendrier GTFS vide),
  - le jour est sous **exception** (calendar_dates: ajout/suppression),
  - la “signature” des services **change** (début/fin de période).
- Ajouter une mention "Changement demain" quand la période bascule (utile à l’approche des vacances/fériés).

### 1.2 Messages “pas de passage” plus pédagogiques
- Quand un arrêt n’a pas de départs:
  - expliquer que c’est potentiellement lié à la **période** (vacances/fériés),
  - proposer de tester une autre heure/date.

### 1.3 Définition “Vacances / Fériés” (classification)
Le GTFS ne nomme pas toujours explicitement "vacances" / "férié".
- Option A (rapide): heuristique sur exceptions + week-end.
- Option B (robuste): **fichier de configuration** des périodes (ranges) + libellés.
- Option C (idéale): source officielle (académie/Éducation Nationale + jours fériés) et fusion avec GTFS.

Livrable: classification fiable “Scolaire / Vacances / Férié” + texte adapté.

---

## Phase 2 — 2 à 4 semaines (fiabilité itinéraires)
- Post-traitement OTP pour éviter des résultats incohérents (ex: “terminus + attendre + reprendre la même ligne”).
- Règles anti-absurde supplémentaires:
  - fusion de legs consécutifs même ligne,
  - suppression d’attentes/retours non justifiés,
  - garde-fous sur temps d’attente et correspondances.

Livrable: itinéraires plus “humains”, moins de faux détours.

---

## Phase 3 — 1 à 2 mois (maintenance données & opérations)
### 3.1 Mise à jour des données (GTFS/OTP)
- Pipeline reproductible:
  - dépôt nouveau GTFS,
  - rebuild graph OTP,
  - redémarrage OTP,
  - validation automatique (sanity checks).

### 3.2 Observabilité
- Logs structurés côté serveur, rotation.
- Dashboard simple (uptime, latences `/api/routes`, taux d’erreurs).

### 3.3 Robustesse offline
- Vérifier que les pages critiques restent utilisables offline (cache + fallback).

Livrable: exploitation “prod” plus simple.

---

## Phase 4 — Trimestre (améliorations fortes)
- Auto-hébergement Photon (fin dépendance externe).
- Caching intelligent des recherches itinéraires (court TTL).
- Mode “grèves/événements”: bannière + fallback + infos réseau.

---

## Rappel clé (demande produit)
- Le site doit **lire l’heure + le jour + les calendriers GTFS**.
- À chaque bascule de période (vacances/fériés/période spéciale), les utilisateurs doivent voir un **rappel visible** car les horaires peuvent changer ou il peut n’y avoir aucun transport.
