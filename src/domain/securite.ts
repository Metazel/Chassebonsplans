/**
 * EXG-02 : aucune saisie ne doit pouvoir contenir un numéro de carte bancaire.
 * Détection : suite de 13 à 19 chiffres (espaces et tirets tolérés) qui passe le contrôle de Luhn.
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

const SUITE = /\d(?:[ -]?\d){12,18}/g;

export function contientNumeroCarte(texte: string): boolean {
  for (const m of texte.matchAll(SUITE)) {
    if (luhn(m[0].replace(/[ -]/g, ''))) return true;
  }
  return false;
}
