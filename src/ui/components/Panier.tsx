/**
 * « Réserver mes trains » : une seule liste à cocher, par site de vente puis par aller-retour.
 * Le voyageur ouvre le site (lien sortant), cherche l'aller-retour, ajoute au panier et coche ici ;
 * puis il indique en une fois « payé » ou « options posées ». Aucune automatisation du site (EXG-08).
 */
import { useState } from 'preact/hooks';
import { dateCourte, dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { dansLePanier, type ElementPanier, type GroupePanier } from '../../domain/panier';
import type { Deplacement, Statut } from '../../domain/deplacements';
import { ExternalLink } from './ExternalLink';

const LIBELLE = { aller: 'Aller Marseille → Paris', retour: 'Retour Paris → Marseille' } as const;

export function Panier(props: {
  groupes: GroupePanier[];
  deplacements: Deplacement[];
  aujourdhui: string;
  onStatut: (cibles: ElementPanier[], statut: Statut, extra?: { le?: string; limiteOption?: string }) => void;
  onAnnonce: (texte: string) => void;
}) {
  const [limite, setLimite] = useState('');
  const auPanier = dansLePanier(props.deplacements);
  if (!props.groupes.length && !auPanier.length) return null;
  const ancien = props.deplacements.some((d) => (['aller', 'retour'] as const).some((c) => d[c].statut === 'panier' && d[c].panierLe && d[c].panierLe! < props.aujourdhui));

  const cocher = (e: ElementPanier, oui: boolean) => {
    props.onStatut([e], oui ? 'panier' : 'a-reserver', oui ? { le: props.aujourdhui } : {});
    props.onAnnonce(oui ? 'Train ajouté à votre panier.' : 'Train retiré du panier.');
  };

  return (
    <section class="panier" aria-labelledby="titre-panier">
      <h2 id="titre-panier">Réserver mes trains</h2>
      <p class="aide">
        Ouvrez le site, cherchez chaque aller-retour, ajoutez-le au panier et cochez ici. Vous payez ensuite une seule fois. Les trains pas encore en
        vente n’apparaissent pas.
      </p>
      {props.groupes.map((g) => (
        <div class="site-vente" key={g.site.nom}>
          <h3>
            {g.site.nom}
            {g.site.nom === 'SNCF Connect' && <span class="aide"> (TGV INOUI, OUIGO, Intercités : un seul panier)</span>}
          </h3>
          <p>
            <ExternalLink href={g.site.url}>Ouvrir {g.site.nom}</ExternalLink>
          </p>
          <ul class="liste-panier">
            {g.lots.map((lot) => {
              const premier = lot.elements[0]!;
              const second = lot.elements[1];
              const date = (e: typeof premier) => dateCourte(e.deplacement[e.cote].date);
              if (lot.type === 'attente') {
                return (
                  <li key={`attente-${premier.deplacement.id}-${premier.cote}`}>
                    <p class="ar">
                      {LIBELLE[premier.cote]} du {date(premier)} : à réserver avec le trajet du {dateCourte(lot.attente!.date)} (aller-retour {lot.croise ? 'croisé ' : ''}carte
                      Avantage), qui ouvre à la vente le {dateLongue(lot.attente!.ouvertureLe)}.
                    </p>
                    <p class="aide">Attendez cette date pour le réserver en une seule recherche : seul, il ne profiterait pas de la carte.</p>
                  </li>
                );
              }
              const titre =
                lot.type === 'carte'
                  ? `Aller-retour ${lot.croise ? 'croisé ' : ''}depuis ${lot.origine} : aller ${date(premier)}, retour ${second ? date(second) : ''} — une seule recherche, carte Avantage`
                  : second
                    ? `Aller-retour du ${date(premier)} au ${date(second)} : une seule recherche`
                    : `${LIBELLE[premier.cote]} du ${date(premier)}`;
              return (
                <li key={lot.elements.map((e) => `${e.deplacement.id}-${e.cote}`).join('+')}>
                  <p class="ar">{titre}</p>
                  {lot.elements.map(({ deplacement: d, cote }) => {
                    const t = d[cote];
                    const id = `panier-${d.id}-${cote}`;
                    return (
                      <label class="ligne-panier" for={id} key={id}>
                        <input id={id} type="checkbox" checked={t.statut === 'panier'} onChange={(ev) => cocher({ id: d.id, cote }, (ev.currentTarget as HTMLInputElement).checked)} />
                        <span>
                          <strong>
                            {cote === 'aller' ? 'Marseille → Paris' : 'Paris → Marseille'} {dateCourte(t.date)} · {formaterHeure(t.train!.depart)} → {formaterHeure(t.train!.arrivee)}
                          </strong>{' '}
                          · {t.train!.operateur} n° {t.train!.numero}
                          <span class="sr-only"> : dans le panier</span>
                        </span>
                      </label>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {auPanier.length > 0 && (
        <div class="finaliser" role="group" aria-labelledby="titre-finaliser">
          <h3 id="titre-finaliser">
            Panier à finaliser : {auPanier.length} train{auPanier.length > 1 ? 's' : ''}
          </h3>
          <p>
            Le panier du site ne bloque ni les places ni les prix : payez, ou posez une option{ancien ? '. Certains trains y sont depuis plus d’un jour : vérifiez le panier sur le site' : ''}.
          </p>
          <button
            type="button"
            onClick={() => {
              props.onStatut(auPanier, 'paye');
              props.onAnnonce(`${auPanier.length} train${auPanier.length > 1 ? 's' : ''} marqué${auPanier.length > 1 ? 's' : ''} payé${auPanier.length > 1 ? 's' : ''}.`);
            }}
          >
            C’est payé
          </button>
          <div class="ligne option-commune">
            <div class="champ">
              <label for="option-commune">Options à payer avant le (facultatif)</label>
              <input id="option-commune" type="date" min={props.aujourdhui} value={limite} onInput={(e) => setLimite((e.currentTarget as HTMLInputElement).value)} />
            </div>
            <button
              type="button"
              class="secondaire"
              onClick={() => {
                props.onStatut(auPanier, 'option', limite ? { limiteOption: limite } : {});
                props.onAnnonce(
                  limite ? `Options enregistrées, à payer avant le ${dateLongue(limite)} : l’agenda pourra vous le rappeler.` : 'Options enregistrées : indiquez leur date limite sur chaque trajet.',
                );
                setLimite('');
              }}
            >
              Options posées
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
