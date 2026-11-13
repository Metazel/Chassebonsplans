/**
 * Préparer une période (CU2) : semaine type, période et congés → semaines à prévoir, à cocher, puis ajout en une fois.
 * Les jours fériés (Etalab, Licence Ouverte 2.0) et les congés écartent une semaine par défaut ; l'aller se change semaine par semaine.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ajouterJours, dateCourte, dateLongue, jourSemaine } from '../../domain/dates';
import { joursAllerPossibles, semainesPeriode, statutDates, verifierModele, type Conges, type SemainePeriode } from '../../domain/periode';
import type { Deplacement } from '../../domain/deplacements';
import { FERIES } from '../../data/feries';
import { ExternalLink } from './ExternalLink';

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const jour = (d: string) => dateCourte(d);

interface Ligne extends SemainePeriode {
  coche: boolean;
}

export function Periode(props: {
  deplacements: Deplacement[];
  aujourdhui: string;
  /** Dernier jour en vente ou annoncé (fin de période proposée). */
  finVentes: string;
  /** Déplacements restant possibles (plafond du stockage). */
  places: number;
  onAjouter: (semaines: { aller: string; retour: string }[]) => void;
}) {
  const [du, setDu] = useState(ajouterJours(props.aujourdhui, 7 - jourSemaine(props.aujourdhui)));
  const [au, setAu] = useState(props.finVentes > props.aujourdhui ? props.finVentes : '');
  const [jourAller, setJourAller] = useState(3);
  const [jourRetour, setJourRetour] = useState(4);
  const [conges, setConges] = useState<Conges[]>([]);
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const titreSemaines = useRef<HTMLHeadingElement>(null);
  const [focusSemaines, setFocusSemaines] = useState(0);
  // Après « Voir les semaines », le focus va au titre de la liste (annonce du nombre de semaines).
  useEffect(() => {
    if (focusSemaines) titreSemaines.current?.focus();
  }, [focusSemaines]);

  const modele = { du, au, jourAller, jourRetour, conges };
  // Champ en cause, pour lier l'erreur (EXG-06).
  const congesFautifs = conges.findIndex((c) => !c.du || !c.au || c.au < c.du);
  const champErreur = !erreur
    ? null
    : /congés/.test(erreur)
      ? `conges-${Math.max(0, congesFautifs)}-${conges[congesFautifs]?.du ? 'au' : 'du'}`
      : /retour/.test(erreur)
        ? 'periode-retour'
        : /fin|semaines/.test(erreur)
          ? 'periode-au'
          : 'periode-du';
  const lie = (id: string) => (champErreur === id ? { 'aria-invalid': 'true' as const, 'aria-describedby': 'periode-err' } : {});
  const voir = (e: Event) => {
    e.preventDefault();
    const err = verifierModele(modele) ?? (du < props.aujourdhui ? 'La période doit commencer aujourd’hui ou plus tard.' : null);
    setErreur(err);
    if (err) {
      setLignes(null);
      return;
    }
    setLignes(semainesPeriode(modele, FERIES, props.deplacements).map((s) => ({ ...s, coche: s.statut === 'propose' })));
    setFocusSemaines((n) => n + 1);
  };
  const majLigne = (lundi: string, maj: (l: Ligne) => Ligne) => setLignes((ls) => ls?.map((l) => (l.lundi === lundi ? maj(l) : l)) ?? null);
  const cochees = lignes?.filter((l) => l.coche && l.statut !== 'existe') ?? [];
  const tropDe = cochees.length > props.places;
  const inconnus = lignes?.some((l) => l.ferieInconnu);

  return (
    <section aria-labelledby="titre-periode">
      <h2 id="titre-periode">Préparer une période</h2>
      <p class="aide">
        Pour une ouverture des ventes : vos jours types à Paris sur toute la période, sans les jours fériés ni vos congés. Vous cochez les semaines, puis
        l’outil prépare les billets.
      </p>
      <form class="ajout" onSubmit={voir} noValidate>
        <div class="ligne">
          <div class="champ">
            <label for="periode-du">Du</label>
            <input id="periode-du" type="date" min={props.aujourdhui} value={du} {...lie('periode-du')} onInput={(e) => setDu((e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div class="champ">
            <label for="periode-au">Au</label>
            <input id="periode-au" type="date" min={du || props.aujourdhui} value={au} {...lie('periode-au')} onInput={(e) => setAu((e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div class="champ">
            <label for="periode-aller">Jour de l’aller (Marseille → Paris)</label>
            <select id="periode-aller" value={jourAller} onChange={(e) => setJourAller(Number((e.currentTarget as HTMLSelectElement).value))}>
              {JOURS.slice(0, 5).map((j, i) => (
                <option value={i} key={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div class="champ">
            <label for="periode-retour">Jour du retour (Paris → Marseille)</label>
            <select id="periode-retour" value={jourRetour} {...lie('periode-retour')} onChange={(e) => setJourRetour(Number((e.currentTarget as HTMLSelectElement).value))}>
              {JOURS.slice(0, 5).map((j, i) => (
                <option value={i} key={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset class="conges">
          <legend>Congés à exclure</legend>
          {conges.length === 0 && <p class="aide">Aucun pour l’instant.</p>}
          {conges.map((c, i) => (
            <div class="ligne" key={i}>
              <div class="champ">
                <label for={`conges-${i}-du`}>Congés {i + 1} : du</label>
                <input
                  id={`conges-${i}-du`}
                  type="date"
                  value={c.du}
                  {...lie(`conges-${i}-du`)}
                  onInput={(e) => setConges(conges.map((x, k) => (k === i ? { ...x, du: (e.currentTarget as HTMLInputElement).value } : x)))}
                />
              </div>
              <div class="champ">
                <label for={`conges-${i}-au`}>Congés {i + 1} : au</label>
                <input
                  id={`conges-${i}-au`}
                  type="date"
                  min={c.du}
                  value={c.au}
                  {...lie(`conges-${i}-au`)}
                  onInput={(e) => setConges(conges.map((x, k) => (k === i ? { ...x, au: (e.currentTarget as HTMLInputElement).value } : x)))}
                />
              </div>
              <div class="champ action">
                <button type="button" class="secondaire" onClick={() => setConges(conges.filter((_, k) => k !== i))}>
                  Retirer les congés {i + 1}
                </button>
              </div>
            </div>
          ))}
          <button type="button" class="secondaire" disabled={conges.length >= 12} onClick={() => setConges([...conges, { du: '', au: '' }])}>
            Ajouter des congés
          </button>
        </fieldset>
        {erreur && (
          <p class="erreur" id="periode-err">
            {erreur}
          </p>
        )}
        <button type="submit">Voir les semaines</button>
      </form>
      {lignes && (
        <div class="semaines">
          <h3 id="titre-semaines" tabIndex={-1} ref={titreSemaines}>
            {lignes.length} semaine{lignes.length > 1 ? 's' : ''} du {dateCourte(du)} au {dateCourte(au)}
          </h3>
          {inconnus && <p class="alerte">Jours fériés inconnus après {FERIES.a} : vérifiez ces semaines vous-même.</p>}
          <ul class="liste-semaines" aria-labelledby="titre-semaines">
            {lignes.map((l) => {
              const id = `semaine-${l.lundi}`;
              return (
                <li key={l.lundi} class={l.statut !== 'propose' ? 'ecartee' : undefined}>
                  {l.statut === 'existe' ? (
                    <p>
                      <strong>Semaine du {dateCourte(l.lundi)}</strong> : déjà prévue dans vos déplacements.
                    </p>
                  ) : (
                    <>
                      <label class="ligne-panier" for={id}>
                        <input id={id} type="checkbox" checked={l.coche} onChange={(e) => majLigne(l.lundi, (x) => ({ ...x, coche: (e.currentTarget as HTMLInputElement).checked }))} />
                        <span>
                          <strong>Semaine du {dateCourte(l.lundi)}</strong> : aller {jour(l.aller)}, retour {jour(l.retour)}
                          {l.statut === 'ferie' && ` — jour férié : ${l.motif}`}
                          {l.statut === 'conges' && ' — vos congés'}
                        </span>
                      </label>
                      <div class="champ champ-court">
                        <label for={`${id}-aller`}>Aller de la semaine du {dateCourte(l.lundi)}</label>
                        <select
                          id={`${id}-aller`}
                          value={l.aller}
                          onChange={(e) => {
                            const aller = (e.currentTarget as HTMLSelectElement).value;
                            majLigne(l.lundi, (x) => {
                              const s = statutDates(aller, x.retour, conges, FERIES);
                              const r: Ligne = { ...x, aller, statut: s.statut, coche: s.statut === 'propose' ? true : x.coche };
                              delete r.motif;
                              if (s.motif) r.motif = s.motif;
                              return r;
                            });
                          }}
                        >
                          {joursAllerPossibles(l).map((d) => (
                            <option value={d} key={d}>
                              {jour(d)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {tropDe && <p class="erreur" id="periode-trop">Vous pouvez encore ajouter {props.places} déplacements : supprimez-en d’anciens ou décochez des semaines.</p>}
          <button
            type="button"
            disabled={!cochees.length || tropDe}
            aria-describedby={tropDe ? 'periode-trop' : undefined}
            onClick={() => {
              props.onAjouter(cochees.map((l) => ({ aller: l.aller, retour: l.retour })));
              setLignes(null);
            }}
          >
            Ajouter {cochees.length} déplacement{cochees.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
      <p class="aide">
        Jours fériés : <ExternalLink href={FERIES.meta.source}>{FERIES.meta.producteur}</ExternalLink>,{' '}
        <ExternalLink href={FERIES.meta.licenceUrl}>{FERIES.meta.licence}</ExternalLink>, données de {FERIES.de} à {FERIES.a} vérifiées le{' '}
        {dateLongue(FERIES.meta.verifieLe)}.
      </p>
    </section>
  );
}
