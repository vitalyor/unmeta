import '@fontsource-variable/onest';
import '@fontsource/unbounded/latin-500.css';
import '@fontsource/unbounded/cyrillic-500.css';
import './app.css';
import { mount } from 'svelte';

// theme before first paint, only if the user picked one (otherwise the system decides)
const theme = localStorage.getItem('um-theme');
if (theme) document.documentElement.dataset.theme = theme;
import App from './App.svelte';

mount(App, { target: document.body });
