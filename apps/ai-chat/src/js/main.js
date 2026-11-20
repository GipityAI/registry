import { mount } from '@gipity/chatbot';
import config from './chatbot.config.js';

// The page is private (gipity.yaml `access`), so whoever sees it is signed in.
mount('#chat', config);

Gipity.auth.user().then((user) => {
  document.getElementById('who').textContent = user?.displayName || user?.email || '';
});
document.getElementById('sign-out').addEventListener('click', async () => {
  await Gipity.auth.signOut();
  location.reload();
});
