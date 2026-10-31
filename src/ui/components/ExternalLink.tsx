import type { ComponentChildren } from 'preact';

/** Lien sortant annoncé (RGAA 13.2) ; aucun référent transmis. */
export function ExternalLink({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span class="sr-only"> (nouvelle fenêtre)</span>
    </a>
  );
}
