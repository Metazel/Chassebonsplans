# CLAUDE.md — Chasse aux bons plans

Consignes pour Claude sur ce dépôt. Réponses et documents en français, synthétiques et orientés action.
Le cadrage complet vit dans le projet claude.ai « [DEV] Chasse aux bons plans » (doc `claude/cadrage.md`) ; ce fichier en reprend l'essentiel.

## Objectif
Aider David et sa famille à choisir leurs déplacements au meilleur rapport qualité-prix, selon les critères de chaque situation et les leviers détenus (cartes, abonnements, assurances, offres partenaires). Généralisation possible plus tard : concevoir comme si l'outil était diffusé.

Situations : (1) trajets domicile-travail hebdomadaires Marseille ↔ Paris ; (2) croisière en famille avec catégorie de cabine cible et repli ; (3) événement familial à l'étranger (vols, voiture, logements, assurances).

## Règle de choix : le coût complet
Coût complet = prix du billet (après leviers) + coûts induits par les horaires. Lot 1 : repas à bord (≈ 10 €) si l'arrivée au domicile dépasse 21h45 (arrivée en gare 21h30 + 15 min). Choix : le coût complet le plus bas ; à égalité (tolérance paramétrable, 2 € par défaut), le train qui ramène le plus tôt. Cas de test de référence « le sandwich » : 19h00 → 22h00 à 30 € contre 17h45 → 20h45 à 40 € → le second.

## Périmètre (quick wins, du moins coûteux au plus coûteux)
- Lot 1 (MVP, sans API ni serveur) : CU1 profil de leviers ; CU2 planning domicile-travail (fériés, congés, créneaux 9h-10h / 17h30-20h) ; CU3 rappels d'ouverture des ventes en .ics ; CU4 simulateur carte Avantage / billets croisés / Liberté / MAX + comparateur au coût complet.
- Lot 2 : capture d'offre par partage (croisière, logement) ; coût tout compris d'un voyage.
- Lot 3 : veille des vols par API d'affiliation (petit serveur) ; zones de logement.
- Hors périmètre : scraping, réservation intégrée, multi-utilisateurs.

## Exigences (EXG) — toutes bloquantes
- EXG-01 Local-first : données uniquement sur l'appareil, aucun compte, aucun serveur, aucune télémétrie.
- EXG-02 Minimisation : type de levier seulement, jamais de numéro de carte ou d'identité (contrôle de Luhn sur les saisies) ; voyageurs par tranche tarifaire, sans nom.
- EXG-03 Conservation : purge des trajets passés au-delà de 24 mois (paramétrable).
- EXG-04 Export JSON et suppression totale en un geste.
- EXG-05 Aucun traceur hors stockage strictement nécessaire, pas de CDN ni de police externe, CSP stricte, aucune requête tierce (vérifié en recette).
- EXG-06 RGAA 4.1.2 niveau AA : contrastes ≥ 4,5:1, clavier, lecteur d'écran, libellés, erreurs liées au champ, zoom 200 % et 320 px sans défilement horizontal, cibles ≥ 44 px. axe-core sans violation en clair et sombre.
- EXG-07 Jours fériés : données DINUM (Licence Ouverte 2.0), source citée, fichier embarqué.
- EXG-08 SNCF Connect : liens sortants seulement, aucune requête automatisée.
- EXG-09 Pas de logos de marques ; mention « outil indicatif, non affilié ».
- EXG-10 Règles tarifaires et paramètres dans des JSON versionnés (`src/data/`) avec source et date de vérification ; alerte au-delà de 6 mois.

Carte Avantage Adulte : A/R avec au moins une nuit de vendredi, samedi ou dimanche, 61 jours maximum entre aller et retour, TGV INOUI et Intercités, prix plafonnés sur trajets directs en 2de. Billets croisés conformes.

## Architecture (ADR)
PWA statique sans serveur (Preact + Vite + TypeScript strict, même socle que ParcPilote). Cœur métier pur dans `src/domain/` (sans DOM, testé unitairement, réutilisable côté serveur au lot 3). Référentiels dans `src/data/`. Écrans dans `src/ui/`. Notifications par fichiers .ics avec alarmes (pas de Web Push avant le lot 3). Stockage IndexedDB (à partir de l'itération qui persiste des données). Budget : ≤ 100 ko de JS compressé, aucune requête réseau après installation.

## Méthode
- Toute modification passe par une pull request ; la fusion sur `main` publie sur GitHub Pages.
- Commits atomiques, messages en français.
- Avant toute PR : `npm run check`, `npm run build`, `npm run build:single`, `python3 e2e/run_e2e.py`. Pas de fusion si un test bloquant échoue.
- Chaque critère d'acceptation a son scénario e2e ; chaque règle métier a ses tests unitaires, dont les cas limites.
- Dependabot (option A, comme ParcPilote) : Claude fusionne seul les mises à jour mineures et correctifs de sécurité quand tous les tests sont verts ; le reste attend l'accord de David.
- Revue critique par un agent séparé avant chaque livraison ; risques résiduels listés dans la PR.
