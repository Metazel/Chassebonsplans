/**
 * EXG-02 : aucune saisie ne doit pouvoir contenir un numéro de carte bancaire.
 * Règle prudente : toute suite d'au moins 13 chiffres (séparateurs tolérés) est refusée, qu'elle passe
 * ou non le contrôle de Luhn. Aucun champ de l'outil n'a besoin d'une telle suite, et un contrôle de Luhn
 * par fenêtres donnerait autant de faux positifs. `luhn` reste disponible pour un usage ciblé.
 */

export function luhn(chiffres: string): boolean {
  let somme = 0;
  let double = false;
  for (let i = chiffres.length - 1; i >= 0; i--) {
    let n = chiffres.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
    double = !double;
  }
  return chiffres.length > 0 && somme % 10 === 0;
}

/** Suites de chiffres séparés au plus par un espace, un tiret, un point ou une barre oblique. */
const SUITE = /\d(?:[ .\-/]?\d)*/g;

export function contientNumeroCarte(texte: string): boolean {
  for (const m of texte.matchAll(SUITE)) {
    if (m[0].replace(/[ .\-/]/g, '').length >= 13) return true;
  }
  return false;
}
