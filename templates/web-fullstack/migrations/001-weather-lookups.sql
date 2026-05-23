-- weather_lookups: persistent log of zip-code weather queries
CREATE TABLE IF NOT EXISTS weather_lookups (
    short_guid VARCHAR(20) PRIMARY KEY,
    zip VARCHAR(10) NOT NULL,
    location VARCHAR(200),
    temperature_f INTEGER,
    condition VARCHAR(100),
    humidity INTEGER,
    wind_mph INTEGER,
    commentary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_lookups_zip ON weather_lookups(zip);
CREATE INDEX IF NOT EXISTS idx_weather_lookups_created ON weather_lookups(created_at DESC);
