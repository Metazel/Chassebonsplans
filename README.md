# Chasse aux bons plans

Préparer ses déplacements Marseille Saint-Charles ↔ Paris et les choisir au **coût complet** : le prix du billet, plus ce que les horaires font dépenser (un repas à bord quand on rentre trop tard). Un retour qui arrive à l'heure du dîner (20h15-21h30 à Marseille) l'emporte s'il ne coûte pas plus de 15 € de plus que le moins cher en coût complet (soit 25 € d'écart de billet face à un retour tardif qui fait dîner à bord) ; à coût égal, celui qui ramène le plus tôt. Version 0.8.0.

## Ce que fait l'application

- **Mes déplacements** (écran d'accueil) : indiquez vos jours d'aller et de retour ; l'appli liste les trains de vos créneaux (aller : arrivée 9h00-9h40 ; retour : départ 17h30-20h00), tous opérateurs (TGV INOUI, OUIGO, Intercités, Trenitalia), d'après les horaires théoriques ouverts mis à jour chaque semaine. Elle signale les retours qui font dîner à bord, propose les trains les plus proches un jour sans train dans le créneau (jour férié), sans jamais proposer de retour avant 17h30 ; les retours qui arrivent à Marseille à l'heure du dîner (20h15-21h30) sont signalés, présélectionnés et préférés jusqu'à 15 € de plus en coût complet, puis prépare la réservation : recherche à copier, lien vers le site de vente (SNCF Connect pour TGV INOUI, OUIGO et Intercités ; trenitalia.fr), suivi à réserver / dans le panier / option posée / payé, date limite d'option, prix payé, export agenda .ics avec rappel la veille de la fin d'option. Rien n'est réservé ni payé dans l'appli.
- **Réserver mes trains** : une seule liste à cocher, par site de vente puis par aller-retour (une recherche par aller-retour) ; « Panier à finaliser » jusqu'au paiement ou aux options (date limite commune).
- **Ouvertures des ventes** : chaque trajet pas encore en vente affiche sa date d'ouverture ; bandeau et rappel agenda (alarme avant l'heure indicative). Calendrier sourcé et daté.
- **Alertes SNCF Connect** : l'appli prépare l'alerte réservation ou petits prix (prix visé) à créer sur son compte SNCF Connect.
- **Suppression** : bouton en tête de chaque déplacement, sélection multiple.
- **Prix vus** : saisissez les prix lus sur le site, ou collez la page de résultats (lecture au mieux, à confirmer ; rien n'est envoyé ni conservé) ; l'appli affiche le coût complet de chaque train et recommande le moins cher, à 2 € près le plus tôt ; « Choisir le … » en un geste ; le prix vu devient le prix payé. Prix de plus de 2 jours écartés de la comparaison ; prix oubliés une fois le trajet payé ou passé.
- **Carte Avantage et billets croisés** : sans la carte, combien de vos trajets en profiteraient (dont grâce au croisement d'une semaine à l'autre), économie maximale sur les trajets planifiés ; avec la carte déclarée, plan optimal de billets aller-retour à prendre, que suit la liste « Réserver mes trains ». Un billet engagé (au panier, en option, payé) n'est plus réapparié.
- **Préparer une ouverture des ventes** : générer d'un coup les déplacements d'une période (jours types d'aller et de retour, jours fériés officiels Etalab embarqués, congés à exclure, aller ajustable semaine par semaine) ; avec la carte Avantage, billets imbriqués par lots de deux semaines (aller de la 1re semaine avec le retour de la 2e, et l'inverse : tous les trajets couverts), regroupés en commandes de 4 billets dans « Réserver mes trains » ; après paiement, import de la confirmation SNCF Connect par copier-coller (trajets payés, trains, prix, billets engagés, rien de personnel conservé) ; bilan des billets payés (coût par trajet, économie de la carte, dîners à bord).
- **Cartes et abonnements** : coût sur un an, en 2de, sans carte, avec la carte Avantage (billets croisés), la carte Liberté (prix fixe de 73 € sur Paris - Marseille), MAX ACTIF (0 € du lundi au jeudi, 250 réservations) et MAX ACTIF+ (7 jours sur 7, 450 réservations), selon votre prix habituel (ou vos prix payés et vus), vos allers-retours par an et la part de vos trajets du lundi au jeudi (calculée sur vos déplacements). Mensualités MAX ACTIF non publiées par la SNCF : estimation sourcée, remplaçable par votre devis.
- **Comparer** : saisissez 2 à 6 trains retour (départ, arrivée en gare, prix) ; l'appli recommande le meilleur au coût complet et en détaille le calcul. Un train incomplet ou un réglage invalide est signalé, jamais remplacé en silence.
- **Réglages** : trajet gare → domicile, heure limite du dîner à la maison (heure théorique, sans marge de retard), prix d'un repas à bord, écart toléré (bornes comprises). Valeurs par défaut sourcées et datées.
- **Mes leviers** : cartes, abonnements, assurance et services détenus (carte Avantage, Liberté, MAX ACTIF, MAX ACTIF+, carte Voyageur, Visa Premier, Pass Ulys, Fnac+), avec effet, conditions, source et date de vérification ; fin de validité facultative, alerte à l'expiration.
- **Mes données** : sauvegarde (fichier JSON, déplacements compris), restauration, suppression totale confirmée ; rappel de sauvegarde tous les 30 jours.

Les déplacements terminés depuis plus de 24 mois sont effacés automatiquement.

À venir : autres leviers (MAX ACTIF, Liberté) dans le simulateur, lot 2 (croisière, mariage).

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
