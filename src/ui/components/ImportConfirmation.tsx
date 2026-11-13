/**
 * « J'ai payé » : coller la confirmation de commande SNCF Connect pour marquer les trajets payés (prix, trains, billets).
 * Lecture locale, aperçu, puis enregistrement sur confirmation (EXG-01, EXG-08). Le texte collé n'est pas conservé.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { dateCourte } from '../../domain/dates';
import { formaterHeure } from '../../domain/heure';
import { formaterMontant } from '../../domain/argent';
import { lireConfirmation, TAILLE_MAX_CONFIRMATION, type Confirmation, type TrajetLu } from '../../domain/confirmation';

const SENS = { MP: 'Marseille → Paris', PM: 'Paris → Marseille' } as const;
const trajet = (t: TrajetLu) => `${SENS[t.sens]} ${dateCourte(t.date)} à ${formaterHeure(t.depart)}${t.numero ? ` (${t.operateur} ${t.numero})` : ''}`;

export function ImportConfirmation(props: { onEnregistrer: (c: Confirmation) => string }) {
  const [texte, setTexte] = useState('');
  const [lue, setLue] = useState<Confirmation | null>(null);
  const [resultat, setResultat] = useState('');
  const trop = texte.length > TAILLE_MAX_CONFIRMATION;
  const rien = !!lue && !lue.billets.length;
  const erreurId = trop ? 'confirmation-err' : rien ? 'confirmation-rien' : undefined;
  const refResultat = useRef<HTMLParagraphElement>(null);
  // Après l'enregistrement, le bouton disparaît : le focus va au compte rendu.
  useEffect(() => {
    if (resultat) refResultat.current?.focus();
  }, [resultat]);

  return (
    <section aria-labelledby="titre-import">
      <h2 id="titre-import">J’ai payé : importer la confirmation</h2>
      <p class="aide">
        Dans le courriel « Confirmation de votre commande » de SNCF Connect, sélectionnez tout le texte, copiez-le et collez-le ici : les trajets passent
        « payé », avec le train, le prix et le billet aller-retour. Rien n’est envoyé, et le texte n’est pas conservé : ni nom, ni référence, ni moyen de
        paiement.
      </p>
      <div class="champ">
        <label for="confirmation-texte">Texte de la confirmation de commande</label>
        <textarea
          id="confirmation-texte"
          rows={5}
          value={texte}
          spellcheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          aria-invalid={erreurId ? 'true' : undefined}
          aria-describedby={erreurId}
          onInput={(e) => {
            setTexte((e.currentTarget as HTMLTextAreaElement).value);
            setLue(null);
            setResultat('');
          }}
        />
        {trop && (
          <span class="erreur" id="confirmation-err">
            Texte trop long : collez une seule confirmation à la fois.
          </span>
        )}
      </div>
      <p>
        <button type="button" disabled={!texte.trim() || trop} onClick={() => setLue(lireConfirmation(texte))}>
          Lire la confirmation
        </button>
      </p>
      <div aria-live="polite">
        {rien && (
          <p class="erreur" id="confirmation-rien">
            Aucun billet reconnu{lue.illisibles ? ` (${lue.illisibles} voyage${lue.illisibles > 1 ? 's' : ''} illisible${lue.illisibles > 1 ? 's' : ''})` : ''} : copiez tout
            le courriel, depuis « Voyage 1 ». Un voyage à plusieurs voyageurs ou avec correspondance se saisit à la main.
          </p>
        )}
        {lue && lue.billets.length > 0 && (
          <div class="apercu-import">
            <h3 id="titre-apercu-import">
              {lue.billets.length} billet{lue.billets.length > 1 ? 's' : ''} lu{lue.billets.length > 1 ? 's' : ''}, {formaterMontant(lue.billets.reduce((s, b) => s + b.prixCentimes, 0))}
            </h3>
            {lue.illisibles > 0 && (
              <p class="alerte">
                {lue.illisibles} voyage{lue.illisibles > 1 ? 's' : ''} illisible{lue.illisibles > 1 ? 's' : ''} : saisissez-le{lue.illisibles > 1 ? 's' : ''} à la main.
              </p>
            )}
            <ol aria-labelledby="titre-apercu-import">
              {lue.billets.map((b, i) => (
                <li key={i}>
                  <strong>
                    {b.trajets.length === 2 ? 'Aller-retour' : 'Aller simple'} {formaterMontant(b.prixCentimes)}
                    {b.tarif === 'avantage' ? ', tarif Avantage' : b.tarif === 'liberte' ? ', tarif Liberté' : ''}
                  </strong>{' '}
                  : {b.trajets.map(trajet).join(' ; puis ')}.
                </li>
              ))}
            </ol>
            <p class="aide">Le prix d’un aller-retour est réparti à parts égales sur ses deux trajets.</p>
            <button
              type="button"
              onClick={() => {
                setResultat(props.onEnregistrer(lue));
                setTexte('');
                setLue(null);
              }}
            >
              Enregistrer ces billets payés
            </button>
          </div>
        )}
        {resultat && (
          <p class="succes" id="import-resultat" tabIndex={-1} ref={refResultat}>
            {resultat}
          </p>
        )}
      </div>
    </section>
  );
}
