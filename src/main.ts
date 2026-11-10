import './style.css';
import { App } from './ui/app';

declare global {
  interface Window {
    naiwa?: App;
  }
}

const app = new App();
window.naiwa = app;
void app.init();
