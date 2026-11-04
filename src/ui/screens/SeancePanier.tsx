/**
 * Séance panier : enchaîne les trains choisis, un par un, pour les mettre dans le panier du site de vente
 * avec le moins de gestes possible (un bouton copie la recherche et ouvre le site ; au retour, « Ajouté ? »).
 * Aucune requête automatisée vers le site (EXG-08) : c'est le voyageur qui ajoute au panier.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { dateLongue } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { GARES, canalVente, texteRecherche } from '../../domain/horaires';
import { sensDu, type Deplacement, type Statut } from '../../domain/deplacements';
export type { ElementPanier } from '../../domain/panier';
export { aMettreAuPanier } from '../../domain/panier';
import type { ElementPanier } from '../../domain/panier';

const LIBELLE: Record<'aller' | 'retour', string> = { aller: 'Aller Marseille → Paris', retour: 'Retour Paris → Marseille' };

export function SeancePanier(props: {
  elements: ElementPanier[];
  deplacements: Deplacement[];
  onStatut: (cibles: ElementPanier[], statut: Statut) => void;
  onFin: () => void;
}) {
  const { elements } = props;
  const [rang, setRang] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [ajoutes, setAjoutes] = useState<ElementPanier[]>([]);
  const [copie, setCopie] = useState<'ok' | 'echec' | null>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  const oui = useRef<HTMLButtonElement>(null);
  const fin = rang >= elements.length;
  const courant = fin ? undefined : elements[rang];
  const dCourant = courant ? props.deplacements.find((x) => x.id === courant.id) : undefined;
  // Trajet supprimé ou déjà traité ailleurs (autre onglet) pendant la séance : on passe au suivant.
  const manquant = !fin && (!dCourant || !courant || !dCourant[courant.cote].train || dCourant[courant.cote].statut !== 'a-reserver');

  useEffect(() => titre.current?.focus(), [rang]);
  // Retour depuis le site de vente : la question « Ajouté au panier ? » reçoit le focus.
  useEffect(() => {
    const surRetour = () => {
      if (document.visibilityState === 'visible' && ouvert) oui.current?.focus();
    };
    document.addEventListener('visibilitychange', surRetour);
    return () => document.removeEventListener('visibilitychange', surRetour);
  }, [ouvert]);

  useEffect(() => {
    if (manquant) setRang((r) => r + 1);
  }, [manquant, rang]);

  const suivant = (ajoute: boolean) => {
    const e = elements[rang];
    if (e && ajoute) {
      props.onStatut([e], 'panier');
      setAjoutes((a) => [...a, e]);
    }
    setOuvert(false);
    setCopie(null);
    setRang((r) => r + 1);
  };

  if (fin) {
    const sites = [...new Set(ajoutes.map((e) => {
      const t = props.deplacements.find((d) => d.id === e.id)?.[e.cote].train;
      return t ? canalVente(t.operateur)?.nom ?? '' : '';
    }))].filter(Boolean);
    return (
      <section class="seance" aria-labelledby="titre-seance">
        <h2 id="titre-seance" tabIndex={-1} ref={titre}>
          Panier prêt
        </h2>
        {ajoutes.length ? (
          <>
            <p>
              {ajoutes.length} train{ajoutes.length > 1 ? 's' : ''} dans votre panier {sites.join(' et ')}. Finalisez sur le site : payez, ou posez une option pour
              bloquer le prix sans payer tout de suite.
            </p>
            <p>Ensuite, indiquez-le ici :</p>
            <div class="actions">
              <button type="button" onClick={() => { props.onStatut(ajoutes, 'paye'); props.onFin(); }}>
                Tout est payé
              </button>
              <button type="button" class="secondaire" onClick={() => { props.onStatut(ajoutes, 'option'); props.onFin(); }}>
                Options posées
              </button>
              <button type="button" class="secondaire" onClick={props.onFin}>
                Plus tard
              </button>
            </div>
            <p class="aide">Pour une option, indiquez ensuite sa date limite sur chaque trajet : l’agenda vous le rappellera la veille.</p>
          </>
        ) : (
          <>
            <p>Aucun train ajouté au panier.</p>
            <button type="button" onClick={props.onFin}>
              Revenir à mes déplacements
            </button>
          </>
        )}
      </section>
    );
  }

  const e = courant!;
  const t = dCourant?.[e.cote];
  if (manquant || !t?.train) return null;
  const sens = sensDu(e.cote);
  const canal = canalVente(t.train.operateur);
  const precedent = rang > 0 ? elements[rang - 1] : undefined;
  const sitePrecedent = precedent ? canalVente(props.deplacements.find((x) => x.id === precedent.id)?.[precedent.cote].train?.operateur ?? '')?.nom : undefined;
  const recherche = texteRecherche({ gareDepart: GARES[sens].depart, gareArrivee: GARES[sens].arrivee, depart: t.train.depart, numero: t.train.numero }, t.date);

  const copierEtOuvrir = () => {
    // Copie (asynchrone) puis ouverture dans le même geste : le navigateur l'autorise sur un clic.
    if (navigator.clipboard) {
      navigator.clipboard.writeText(recherche).then(
        () => setCopie('ok'),
        () => setCopie('echec'),
      );
    } else setCopie('echec');
    if (canal) window.open(canal.url, '_blank', 'noopener,noreferrer');
    setOuvert(true);
  };

  return (
    <section class="seance" aria-labelledby="titre-seance">
      <h2 id="titre-seance" tabIndex={-1} ref={titre}>
        Préparer mon panier — train {rang + 1} sur {elements.length}
      </h2>
      <progress max={elements.length} value={rang} aria-label={`${rang} trains traités sur ${elements.length}`} />
      {canal && canal.nom !== sitePrecedent && (
        <p class="aide">
          {rang === 0 ? 'Site de vente' : 'Changement de site'} : {canal.nom}
          {canal.nom === 'SNCF Connect' ? ' (TGV INOUI, OUIGO et Intercités dans un même panier).' : ' (panier séparé).'}
        </p>
      )}
      <div class="carte-panier">
        <h3>
          {LIBELLE[e.cote]} — {dateLongue(t.date)}
        </h3>
        <p class="horaire">
          {formaterHeure(t.train.depart)} → {formaterHeure(t.train.arrivee)} · {t.train.operateur} {t.train.numero}
        </p>
        <p class="recherche">{recherche}</p>
      </div>
      <ol class="etapes">
        <li>
          <button type="button" class={ouvert ? 'secondaire' : undefined} onClick={copierEtOuvrir}>
            Copier et ouvrir {canal?.nom ?? 'le site de vente'}
          </button>
          <span class="sr-only"> (nouvelle fenêtre)</span>
        </li>
        <li>Collez la recherche, choisissez ce train et ajoutez-le au panier.</li>
        <li>
          Revenez ici :
          <div class="actions">
            <button type="button" ref={oui} class={ouvert ? undefined : 'secondaire'} onClick={() => suivant(true)}>
              Ajouté au panier, train suivant
            </button>
            <button type="button" class="secondaire" onClick={() => suivant(false)}>
              Passer ce train
            </button>
          </div>
        </li>
      </ol>
      <p class="aide" aria-live="polite">
        {copie === 'ok' && 'Recherche copiée.'}
        {copie === 'echec' && 'Copie impossible ici : recopiez le numéro du train et la date.'}
      </p>
      <button type="button" class="lien-discret" onClick={props.onFin}>
        Arrêter la séance
      </button>
    </section>
  );
}
