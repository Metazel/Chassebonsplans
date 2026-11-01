# Chasse aux bons plans

Préparer ses déplacements Marseille Saint-Charles ↔ Paris et les choisir au **coût complet** : le prix du billet, plus ce que les horaires font dépenser (un repas à bord quand on rentre trop tard). À coût égal, le train qui ramène le plus tôt à la maison l'emporte. Version 0.3.0.

## Ce que fait l'application

- **Mes déplacements** (écran d'accueil) : indiquez vos jours d'aller et de retour ; l'appli liste les trains de vos créneaux (aller : arrivée 9h00-9h40 ; retour : départ 17h30-20h00), tous opérateurs (TGV INOUI, OUIGO, Intercités, Trenitalia), d'après les horaires théoriques ouverts mis à jour chaque semaine. Elle signale les retours qui font dîner à bord, propose les trains les plus proches un jour sans train dans le créneau (jour férié), puis prépare la réservation : recherche à copier, lien vers le site de vente (aucun pour OUIGO), suivi à réserver / option posée / payé, date limite d'option, prix payé, export agenda .ics avec rappel la veille de la fin d'option. Rien n'est réservé ni payé dans l'appli.
- **Comparer** : saisissez 2 à 6 trains retour (départ, arrivée en gare, prix) ; l'appli recommande le meilleur au coût complet et en détaille le calcul. Un train incomplet ou un réglage invalide est signalé, jamais remplacé en silence.
- **Réglages** : trajet gare → domicile, heure limite du dîner à la maison (heure théorique, sans marge de retard), prix d'un repas à bord, écart toléré (bornes comprises). Valeurs par défaut sourcées et datées.
- **Mes leviers** : cartes, abonnements, assurance et services détenus (carte Avantage, Liberté, MAX ACTIF, carte Voyageur, Visa Premier, Pass Ulys, Fnac+), avec effet, conditions, source et date de vérification ; fin de validité facultative, alerte à l'expiration.
- **Mes données** : sauvegarde (fichier JSON, déplacements compris), restauration, suppression totale confirmée ; rappel de sauvegarde tous les 30 jours.

Les déplacements terminés depuis plus de 24 mois sont effacés automatiquement.

À venir : simulateur carte Avantage avec billets croisés, rappels d'ouverture des ventes, prix réels par la saisie de la page de résultats.

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
  domain/   règles métier pures : heures, dates, montants, coût complet, horaires, déplacements, agenda .ics, profil, sécurité
  data/     paramètres et catalogue des leviers en JSON (source + date de vérification), validés au chargement
  state/    stockage local IndexedDB avec repli en mémoire, chargement des horaires
  ui/       écrans Preact (Mes déplacements, Comparer, Mes leviers, Mes données), styles, police auto-hébergée
static/horaires.json  horaires publiés avec l'appli (échantillon en dépôt, remplacé à chaque publication)
scripts/  extraction des horaires depuis les GTFS ouverts SNCF (ODbL) et Trenitalia France (Licence Ouverte 2.0)
tests/      tests unitaires (Vitest)
e2e/        recette navigateur (Playwright, métier + RGAA)
```

## Mise en ligne

Le workflow `.github/workflows/ci.yml` vérifie, extrait les horaires réels depuis transport.data.gouv.fr, construit, teste puis publie sur GitHub Pages à chaque fusion sur `main` et chaque lundi (horaires rafraîchis). Si l'extraction échoue, rien n'est publié et la version en ligne reste (Settings > Pages > Source : GitHub Actions). Dependabot propose chaque semaine les mises à jour, avec un délai de 14 jours.

Application indépendante, non affiliée à la SNCF ni aux autres marques citées. Les règles tarifaires sont indicatives : vérifiez-les au moment de l'achat.
