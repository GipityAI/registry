// App entry point - calls our own server functions for weather + recent lookups
import { settings } from './settings.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('weather-form');
  const resultDiv = document.getElementById('result');
  const errorDiv = document.getElementById('error');

  loadRecent();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    resultDiv.hidden = true;
    errorDiv.hidden = true;

    const zip = document.getElementById('zip').value.trim();
    if (!/^\d{5}$/.test(zip)) {
      showError('Please enter a valid 5-digit US zip code.');
      return;
    }

    const btn = form.querySelector('button');
    btn.textContent = 'Looking up weather...';
    btn.disabled = true;

    try {
      const data = await Gipity.fn('get-weather', { zip });

      if (data.error) {
        showError(data.error);
        return;
      }

      document.getElementById('location').textContent = `${data.location} ${data.zip}`;
      document.getElementById('temp').textContent = `${data.temperature_f}°F`;
      document.getElementById('condition').textContent = data.condition;
      document.getElementById('humidity').textContent = `${data.humidity}%`;
      document.getElementById('wind').textContent = `${data.wind_mph} mph`;
      document.getElementById('commentary').textContent = data.commentary;
      resultDiv.hidden = false;

      loadRecent();
    } catch (err) {
      showError('Network error - please try again.');
    } finally {
      btn.textContent = 'Get Weather';
      btn.disabled = false;
    }
  });

  function showError(msg) {
    document.getElementById('error-msg').textContent = msg;
    errorDiv.hidden = false;
  }

  async function loadRecent() {
    const list = document.getElementById('recent-list');
    try {
      const data = await Gipity.fn('get-recent', { limit: settings.recentLimit });
      const lookups = data.lookups || [];
      if (lookups.length === 0) {
        list.innerHTML = '<li>No recent lookups yet.</li>';
        return;
      }
      list.innerHTML = lookups
        .map(l => `<li><strong>${l.zip}</strong> - ${l.location}: ${l.temperature_f}°F, ${l.condition}</li>`)
        .join('');
    } catch (err) {
      list.innerHTML = '<li>Network error - please try again.</li>';
    }
  }
});
