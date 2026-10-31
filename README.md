# Chasse aux bons plans

Choisir ses déplacements au **coût complet** : le prix du billet, plus ce que les horaires font dépenser (un repas à bord quand on rentre trop tard). À coût égal, le train qui ramène le plus tôt à la maison l'emporte. Version 0.2.0.

## Ce que fait l'application

- **Comparer** : saisissez 2 à 6 trains retour (départ, arrivée en gare, prix) ; l'appli recommande le meilleur au coût complet et en détaille le calcul. Un train incomplet ou un réglage invalide est signalé, jamais remplacé en silence.
- **Réglages** : trajet gare → domicile, heure limite du dîner à la maison (heure théorique, sans marge de retard), prix d'un repas à bord, écart toléré (bornes comprises). Valeurs par défaut sourcées et datées.
- **Mes leviers** : cartes, abonnements, assurance et services détenus (carte Avantage, Liberté, MAX ACTIF, carte Voyageur, Visa Premier, Pass Ulys, Fnac+), avec effet, conditions, source et date de vérification ; fin de validité facultative, alerte à l'expiration.
- **Mes données** : sauvegarde (fichier JSON), restauration, suppression totale confirmée ; rappel de sauvegarde tous les 30 jours.

À venir (lot 1) : planning domicile-travail, rappels d'ouverture des ventes, simulateur carte Avantage avec billets croisés.

## Vie privée, sécurité, accessibilité

- 100 % local : aucun compte, aucun serveur, aucune requête vers un tiers (vérifié en recette). Données dans IndexedDB sur l'appareil, validées à chaque relecture ; repli en mémoire signalé si le stockage est indisponible. Aucun numéro de carte n'est demandé ni accepté (contrôle de Luhn).
- CSP stricte (`script-src 'self'`, `connect-src 'self'`), police auto-hébergée (Atkinson Hyperlegible Next, licence OFL), aucun HTML injecté.
- RGAA 4.1 visé niveau AA : axe-core sans violation en clair et sombre, 320 px et texte à 200 % sans défilement horizontal, erreurs liées aux champs, cibles de 44 px, navigation clavier. Conformité non auditée par un tiers.

## Démarrer

```bash
npm install
npm run dev            # développement
npm run check          # types stricts + lint + tests unitaires
npm run build          # PWA installable dans dist/
npm run build:single   # un seul fichier HTML autonome dans dist-single/
npm run test:e2e       # recette navigateur (pip install -r e2e/requirements.txt)
```

## Architecture

```
src/
  domain/   règles métier pures : heures, montants, coût complet, saisies, profil, sécurité, référentiels
  data/     paramètres et catalogue des leviers en JSON (source + date de vérification), validés au chargement
  state/    stockage local IndexedDB avec repli en mémoire
  ui/       écrans Preact (Comparer, Mes leviers, Mes données), styles, police auto-hébergée
tests/      tests unitaires (Vitest)
e2e/        recette navigateur (Playwright, métier + RGAA)
```

## Mise en ligne

Le workflow `.github/workflows/ci.yml` vérifie, construit, teste puis publie sur GitHub Pages à chaque fusion sur `main` (Settings > Pages > Source : GitHub Actions). Dependabot propose chaque semaine les mises à jour, avec un délai de 14 jours.

Application indépendante, non affiliée à la SNCF ni aux autres marques citées. Les règles tarifaires sont indicatives : vérifiez-les au moment de l'achat.
