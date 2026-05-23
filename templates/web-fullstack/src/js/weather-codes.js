// weather-codes.js - Weather code descriptions and commentary
// Shared across web-simple (client-side), web-fullstack (client + server), and api (server) templates.
// Source of truth: scaffolds/_shared/weather/weather-codes.js

export function describeWeatherCode(code) {
    const descriptions = {
        0: 'Clear sky',
        1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Foggy', 48: 'Depositing rime fog',
        51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
        61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
        71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
        77: 'Snow grains',
        80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
        85: 'Slight snow showers', 86: 'Heavy snow showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
    };
    return descriptions[code] || 'Unknown';
}

export function getCommentary(temp, condition) {
    if (temp >= 90) return "It's scorching out there - stay hydrated!";
    if (temp >= 80) return 'Beautiful warm weather. Perfect for the beach.';
    if (temp >= 70) return 'Really nice out. Ideal day to be outside.';
    if (temp >= 60) return 'Pleasant and comfortable. Light jacket maybe.';
    if (temp >= 50) return "A bit cool. You'll want a layer.";
    if (temp >= 40) return 'Getting chilly. Grab a coat.';
    if (temp >= 30) return "Cold out there. Bundle up!";
    if (temp < 30) return "Freezing! Stay warm.";

    if (condition.toLowerCase().includes('thunder')) return 'Stormy - maybe stay indoors.';
    if (condition.toLowerCase().includes('snow')) return 'Snow day! Drive carefully.';

    return 'Check the sky before heading out.';
}
