// get-recent.js - Return the most recent weather lookups
// Called via: POST /api/{app}/fn/get-recent { limit?: number }

export default async function getRecent(ctx, { db }) {
    const { limit } = ctx.body;
    const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

    const result = await db.query(
        `SELECT short_guid, zip, location, temperature_f, condition, humidity, wind_mph, commentary, created_at
         FROM weather_lookups
         ORDER BY created_at DESC
         LIMIT $1`,
        [cap]
    );

    return { lookups: result.rows };
}
