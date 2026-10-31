import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';

const racine = document.getElementById('app');
if (racine) render(<App />, racine);

if (__PWA__ && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* Hors ligne indisponible : l'appli reste utilisable en ligne. */
  });
}
