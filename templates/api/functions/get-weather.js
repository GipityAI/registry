// get-weather.js - Get current weather for a US zip code
// Called via: POST /api/{app}/fn/get-weather { zip: "90210" }
// Uses the free Open-Meteo API (no key required)
// Source of truth: scaffolds/_shared/weather/get-weather.js

export default async function getWeather(ctx, { fetch }) {
    const { zip } = ctx.body;
    if (!zip || typeof zip !== 'string' || !/^\d{5}$/.test(zip)) {
        return { error: 'Valid 5-digit US zip code required' };
    }

    // Step 1: Geocode the zip code
    const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=1&language=en&format=json`
    );
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
        return { error: `Could not find location for zip ${zip}` };
    }

    const { latitude, longitude, name: city, admin1: state } = geoData.results[0];

    // Step 2: Get current weather
    const wxRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
    );
    const wxData = await wxRes.json();
    const current = wxData.current;

    const temp = Math.round(current.temperature_2m);
    const humidity = current.relative_humidity_2m;
    const wind = Math.round(current.wind_speed_10m);
    const condition = describeWeatherCode(current.weather_code);

    return {
        location: `${city}, ${state}`,
        zip,
        temperature_f: temp,
        condition,
        humidity,
        wind_mph: wind,
        commentary: getCommentary(temp, condition),
        timestamp: current.time,
    };
}

function describeWeatherCode(code) {
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

function getCommentary(temp, condition) {
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
