import { useState } from 'preact/hooks';

export function Champ(props: {
  id: string;
  libelle: string;
  valeur: string;
  type?: 'text' | 'time';
  aide?: string;
  erreur?: string | undefined;
  inputMode?: 'decimal' | 'numeric';
  onInput: (v: string) => void;
}) {
  // Une erreur ne s'affiche qu'une fois le champ quitté (pas pendant la première saisie).
  const [visite, setVisite] = useState(false);
  const erreur = visite ? props.erreur : undefined;
  const decrit = [props.aide ? `${props.id}-aide` : '', erreur ? `${props.id}-err` : ''].filter(Boolean).join(' ');
  const commun = {
    id: props.id,
    value: props.valeur,
    autoComplete: 'off',
    'aria-invalid': erreur ? ('true' as const) : undefined,
    'aria-describedby': decrit || undefined,
    onInput: (e: Event) => props.onInput((e.currentTarget as HTMLInputElement).value),
    onBlur: () => setVisite(true),
  };
  return (
    <div class="champ">
      <label for={props.id}>{props.libelle}</label>
      {props.aide && (
        <span class="aide" id={`${props.id}-aide`}>
          {props.aide}
        </span>
      )}
      {props.type === 'time' ? <input type="time" {...commun} /> : <input type="text" inputMode={props.inputMode} {...commun} />}
      {erreur && (
        <span class="erreur" id={`${props.id}-err`}>
          {erreur}
        </span>
      )}
    </div>
  );
}
