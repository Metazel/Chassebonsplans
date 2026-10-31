import { useRef, useState } from 'preact/hooks';
import { aDesDonnees, exporter, importer, type Profil } from '../../domain/profil';
import { LEVIERS } from '../../data/leviers';

const IDS = new Set(LEVIERS.map((l) => l.id));

export function Donnees(props: {
  profil: Profil;
  mode: 'local' | 'memoire';
  aujourdhui: string;
  onExporte: () => void;
  onImporte: (p: Profil) => void;
  onSupprime: () => void;
}) {
  const [message, setMessage] = useState<{ type: 'ok' | 'erreur'; texte: string } | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);

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
    setMessage({ type: 'ok', texte: 'Sauvegarde téléchargée. Gardez ce fichier en lieu sûr.' });
  };

  const lire = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const p = importer(await f.text(), IDS);
      props.onImporte(p);
      setMessage({ type: 'ok', texte: 'Sauvegarde restaurée.' });
    } catch (err) {
      setMessage({ type: 'erreur', texte: err instanceof Error ? err.message : 'Fichier illisible.' });
    } finally {
      if (fichier.current) fichier.current.value = '';
    }
  };

  return (
    <>
      <h1 id="titre-vue" tabIndex={-1}>
        Mes données
      </h1>
      <p class="intro">
        Tout reste sur cet appareil : aucun compte, aucun serveur, rien n’est envoyé sur Internet. Vous pouvez à tout moment sauvegarder, restaurer ou
        tout effacer.
      </p>
      {props.mode === 'memoire' && (
        <p class="alerte" role="status">
          Le stockage de cet appareil est indisponible (navigation privée ?) : vos choix seront perdus en fermant la page. Pensez à sauvegarder.
        </p>
      )}
      <div aria-live="polite">{message && <p class={message.type === 'ok' ? 'succes' : 'erreur'}>{message.texte}</p>}</div>

      <section aria-labelledby="titre-sauver">
        <h2 id="titre-sauver">Sauvegarder</h2>
        <p>Télécharge un fichier JSON avec vos leviers et vos réglages, à conserver ou à transférer sur un autre appareil.</p>
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
            Remplace vos leviers et réglages actuels.
          </span>
          <input ref={fichier} id="import" type="file" accept="application/json,.json" aria-describedby="import-aide" onChange={lire} />
        </div>
      </section>

      <section aria-labelledby="titre-effacer">
        <h2 id="titre-effacer">Tout effacer</h2>
        <p>Supprime définitivement vos leviers et réglages de cet appareil.</p>
        {!confirmer ? (
          <button type="button" class="danger" disabled={!aDesDonnees(props.profil)} onClick={() => setConfirmer(true)}>
            Tout effacer
          </button>
        ) : (
          <div class="confirmation" role="group" aria-labelledby="confirmation-texte">
            <p id="confirmation-texte">Confirmez-vous la suppression définitive ? Cette action est irréversible.</p>
            <button
              type="button"
              class="danger"
              ref={(b) => b?.focus()}
              onClick={() => {
                props.onSupprime();
                setConfirmer(false);
                setMessage({ type: 'ok', texte: 'Toutes vos données ont été effacées de cet appareil.' });
              }}
            >
              Oui, tout effacer
            </button>{' '}
            <button type="button" class="secondaire" onClick={() => setConfirmer(false)}>
              Annuler
            </button>
          </div>
        )}
      </section>
    </>
  );
}
