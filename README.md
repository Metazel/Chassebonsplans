# Chasse aux bons plans

Choisir ses déplacements au **coût complet** : le prix du billet, plus ce que les horaires font dépenser (un repas à bord quand on rentre trop tard). À coût égal, le train qui ramène le plus tôt à la maison l'emporte. Version 0.1.0.

## Ce que fait l'application (itération 1)

- **Comparateur de trains retour** : saisissez 2 à 6 trains (départ, arrivée en gare, prix) ; l'appli recommande le meilleur au coût complet et en détaille le calcul.
- **Réglages** : trajet gare → domicile, heure limite du dîner à la maison, prix d'un repas à bord, tolérance d'égalité. Valeurs par défaut sourcées et datées, signalées si elles n'ont pas été revérifiées depuis 6 mois.

À venir (lot 1) : profil de leviers, planning domicile-travail, rappels d'ouverture des ventes, simulateur carte Avantage avec billets croisés.

## Vie privée, sécurité, accessibilité

- 100 % local : aucun compte, aucun serveur, aucune requête vers un tiers (vérifié en recette). Rien n'est envoyé sur Internet.
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
  domain/   règles métier pures : heures, montants, coût complet, référentiels versionnés
  data/     paramètres et règles en JSON (source + date de vérification), validés au chargement
  ui/       écrans Preact, styles, police auto-hébergée
tests/      tests unitaires (Vitest)
e2e/        recette navigateur (Playwright, métier + RGAA)
```

## Mise en ligne

Le workflow `.github/workflows/ci.yml` vérifie, construit, teste puis publie sur GitHub Pages à chaque fusion sur `main` (Settings > Pages > Source : GitHub Actions). Dependabot propose chaque semaine les mises à jour, avec un délai de 14 jours.

Application indépendante, non affiliée à la SNCF ni aux autres marques citées. Les règles tarifaires sont indicatives : vérifiez-les au moment de l'achat.
