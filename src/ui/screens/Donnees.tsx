import { useEffect, useRef, useState } from 'preact/hooks';
import { TAILLE_MAX_IMPORT, aDesDonnees, exporter, importer, type Profil } from '../../domain/profil';
import { LEVIERS } from '../../data/leviers';

const IDS = new Set(LEVIERS.map((l) => l.id));

type Message = { type: 'ok' | 'erreur'; texte: string; cible: 'sauver' | 'restaurer' | 'effacer' };

export function Donnees(props: {
  profil: Profil;
  mode: 'local' | 'memoire';
  aujourdhui: string;
  onExporte: () => void;
  onImporte: (p: Profil) => Promise<boolean>;
  onSupprime: () => Promise<boolean>;
}) {
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);
  const boutonEffacer = useRef<HTMLButtonElement>(null);
  const boutonAnnuler = useRef<HTMLButtonElement>(null);
  const zoneMessage = useRef<HTMLParagraphElement>(null);
  const focusApres = useRef<'annuler' | 'effacer' | 'message' | null>(null);

  // Focus (RGAA 12.8) : sur « Annuler » à l'ouverture de la confirmation (jamais sur le bouton destructeur),
  // de retour sur « Tout effacer » après annulation, sur le message après suppression.
  useEffect(() => {
    const cible = focusApres.current;
    focusApres.current = null;
    if (cible === 'annuler') boutonAnnuler.current?.focus();
    else if (cible === 'effacer') boutonEffacer.current?.focus();
    else if (cible === 'message') zoneMessage.current?.focus();
  }, [confirmer, message]);

  const telecharger = () => {
    const blob = new Blob([exporter(props.profil, props.aujourdhui)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chassebonsplans-sauvegarde-${props.aujourdhui}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    props.onExporte();
    setMessage({ type: 'ok', texte: 'Sauvegarde téléchargée. Gardez ce fichier en lieu sûr.', cible: 'sauver' });
  };

  const lire = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      if (f.size > TAILLE_MAX_IMPORT) throw new Error('Fichier trop volumineux pour une sauvegarde.');
      const { profil, ecartes } = importer(await f.text(), IDS);
      const ok = await props.onImporte(profil);
      const suffixe = ecartes.length ? ` Éléments ignorés : ${ecartes.join(', ')}.` : '';
      setMessage(
        ok
          ? { type: 'ok', texte: `Sauvegarde restaurée.${suffixe}`, cible: 'restaurer' }
          : { type: 'erreur', texte: 'Sauvegarde lue, mais impossible de l’enregistrer sur cet appareil.', cible: 'restaurer' },
      );
    } catch (err) {
      setMessage({ type: 'erreur', texte: err instanceof Error ? err.message : 'Fichier illisible.', cible: 'restaurer' });
    } finally {
      if (fichier.current) fichier.current.value = '';
    }
  };

  const erreurImport = message?.cible === 'restaurer' && message.type === 'erreur' ? message.texte : null;
  const messageGeneral = message && !erreurImport ? message : null;

  return (
    <>
      <h1 id="titre-vue" tabIndex={-1}>
        Mes données
      </h1>
      <p class="intro">
        Tout reste sur cet appareil : aucun compte, aucun serveur, rien n’est envoyé sur Internet. Vos données disparaissent si vous effacez les données
        du navigateur ou si vous utilisez la navigation privée : sauvegardez régulièrement.
      </p>
      {props.mode === 'memoire' && (
        <p class="alerte" role="status">
          Le stockage de cet appareil est indisponible : vos choix seront perdus en fermant la page. Pensez à sauvegarder.
        </p>
      )}
      <div aria-live="polite">
        {messageGeneral && (
          <p ref={zoneMessage} tabIndex={-1} class={messageGeneral.type === 'ok' ? 'succes' : 'erreur'}>
            {messageGeneral.texte}
          </p>
        )}
      </div>

      <section aria-labelledby="titre-sauver">
        <h2 id="titre-sauver">Sauvegarder</h2>
        <p>Télécharge un fichier JSON avec vos leviers, vos réglages et vos déplacements, à conserver ou à transférer sur un autre appareil.</p>
        <p class="aide">
          {props.profil.derniereSauvegarde ? `Dernière sauvegarde : ${props.profil.derniereSauvegarde}.` : 'Aucune sauvegarde pour l’instant.'}
        </p>
        <button type="button" onClick={telecharger}>
          Télécharger ma sauvegarde
        </button>
      </section>

      <section aria-labelledby="titre-restaurer">
        <h2 id="titre-restaurer">Restaurer</h2>
        <div class="champ">
          <label for="import">Choisir un fichier de sauvegarde (.json)</label>
          <span class="aide" id="import-aide">
            Remplace vos leviers, réglages et déplacements actuels.
          </span>
          <input
            ref={fichier}
            id="import"
            type="file"
            accept="application/json,.json"
            aria-invalid={erreurImport ? 'true' : undefined}
            aria-describedby={erreurImport ? 'import-aide import-err' : 'import-aide'}
            onChange={lire}
          />
          {erreurImport && (
            <span class="erreur" id="import-err" role="alert">
              {erreurImport}
            </span>
          )}
        </div>
      </section>

      <section aria-labelledby="titre-effacer">
        <h2 id="titre-effacer">Tout effacer</h2>
        <p>Supprime définitivement vos leviers, réglages et déplacements de cet appareil, dans tous les onglets ouverts.</p>
        {!confirmer ? (
          <button
            type="button"
            class="danger"
            ref={boutonEffacer}
            onClick={() => {
              if (!aDesDonnees(props.profil)) {
                setMessage({ type: 'ok', texte: 'Aucune donnée à effacer.', cible: 'effacer' });
                return;
              }
              focusApres.current = 'annuler';
              setConfirmer(true);
            }}
          >
            Tout effacer
          </button>
        ) : (
          <div class="confirmation" role="group" aria-labelledby="confirmation-texte">
            <p id="confirmation-texte">Confirmez-vous la suppression définitive ? Cette action est irréversible.</p>
            <button
              type="button"
              class="danger"
              onClick={async () => {
                const ok = await props.onSupprime();
                focusApres.current = 'message';
                setConfirmer(false);
                setMessage(
                  ok
                    ? { type: 'ok', texte: 'Toutes vos données ont été effacées de cet appareil.', cible: 'effacer' }
                    : { type: 'erreur', texte: 'La suppression a échoué : réessayez ou effacez les données du site dans le navigateur.', cible: 'effacer' },
                );
              }}
            >
              Oui, tout effacer
            </button>{' '}
            <button
              type="button"
              class="secondaire"
              ref={boutonAnnuler}
              onClick={() => {
                focusApres.current = 'effacer';
                setConfirmer(false);
              }}
            >
              Annuler
            </button>
          </div>
        )}
      </section>
    </>
  );
}
