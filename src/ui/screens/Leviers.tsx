import { LEVIERS, LIBELLES_CATEGORIES, type Categorie, type Levier } from '../../data/leviers';
import { estAReverifier } from '../../domain/referentiel';
import { estDateIso, etatValidite, type EtatLevier, type Profil } from '../../domain/profil';
import { ExternalLink } from '../components/ExternalLink';

const ORDRE: Categorie[] = ['train', 'assurance', 'route', 'partenaires'];

function CarteLevier({ levier, etat, aujourdhui, onChange }: { levier: Levier; etat: EtatLevier | undefined; aujourdhui: string; onChange: (e: EtatLevier) => void }) {
  const detenu = etat?.detenu ?? false;
  const fin = etat?.finValidite;
  const validite = detenu && fin ? etatValidite(fin, aujourdhui) : null;
  const idBase = `lev-${levier.id}`;
  return (
    <li class={`levier${detenu ? ' detenu' : ''}`}>
      <div class="levier-tete">
        <input
          type="checkbox"
          id={`${idBase}-detenu`}
          checked={detenu}
          aria-describedby={`${idBase}-effet`}
          onChange={(e) => onChange({ ...etat, detenu: (e.currentTarget as HTMLInputElement).checked })}
        />
        <label for={`${idBase}-detenu`}>
          {levier.nom}
          <span class="levier-prix"> — {levier.prix}</span>
        </label>
      </div>
      <p id={`${idBase}-effet`}>{levier.effet}</p>
      {detenu && levier.validiteAnnuelle && (
        <div class="champ champ-court">
          <label for={`${idBase}-fin`}>Fin de validité (facultatif)</label>
          <input
            type="date"
            id={`${idBase}-fin`}
            value={fin ?? ''}
            aria-describedby={validite && validite !== 'valide' ? `${idBase}-validite` : undefined}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              onChange(estDateIso(v) ? { detenu, finValidite: v } : { detenu });
            }}
          />
          {validite === 'expire' && (
            <span class="alerte" role="status" id={`${idBase}-validite`}>
              Expirée : elle n’est plus prise en compte tant que vous ne la renouvelez pas.
            </span>
          )}
          {validite === 'bientot' && (
            <span class="alerte" role="status" id={`${idBase}-validite`}>
              Expire dans moins de 30 jours.
            </span>
          )}
        </div>
      )}
      <details>
        <summary>Conditions</summary>
        <ul>
          {levier.conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p class="aide">
          Source : <ExternalLink href={levier.source}>{new URL(levier.source).hostname}</ExternalLink>, vérifiée le {levier.verifieLe}.
          {estAReverifier(levier.verifieLe, new Date()) && <strong> À revérifier (plus de 6 mois).</strong>}
        </p>
      </details>
    </li>
  );
}

export function Leviers({ profil, aujourdhui, onChange }: { profil: Profil; aujourdhui: string; onChange: (id: string, e: EtatLevier) => void }) {
  return (
    <>
      <h1 id="titre-vue" tabIndex={-1}>
        Mes leviers
      </h1>
      <p class="intro">
        Cochez les cartes, abonnements et services que vous détenez : l’outil s’en servira pour calculer vos coûts. Seul le fait de les détenir est
        enregistré, sur cet appareil ; aucun numéro de carte n’est demandé.
      </p>
      {ORDRE.map((cat) => {
        const liste = LEVIERS.filter((l) => l.categorie === cat);
        if (!liste.length) return null;
        return (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`}>{LIBELLES_CATEGORIES[cat]}</h2>
            <ul class="leviers">
              {liste.map((l) => (
                <CarteLevier key={l.id} levier={l} etat={profil.leviers[l.id]} aujourdhui={aujourdhui} onChange={(e) => onChange(l.id, e)} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
