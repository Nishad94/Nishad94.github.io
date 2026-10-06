CREATE SCHEMA IF NOT EXISTS metrics;
CREATE TABLE IF NOT EXISTS metrics.days (
    day date PRIMARY KEY,
    views bigint NOT NULL DEFAULT 0,
    uniques bigint NOT NULL DEFAULT 0,
    unidentified bigint NOT NULL DEFAULT 0,
    unknown_country bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS metrics.buckets (
    day date NOT NULL REFERENCES metrics.days(day) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('page', 'referrer', 'country')),
    label varchar(200) NOT NULL,
    views bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, label)
);
CREATE TABLE IF NOT EXISTS metrics.daily_keys (
    day date PRIMARY KEY REFERENCES metrics.days(day) ON DELETE CASCADE,
    key bytea NOT NULL CHECK (octet_length(key) = 32)
);
CREATE TABLE IF NOT EXISTS metrics.visitors (
    day date NOT NULL REFERENCES metrics.days(day) ON DELETE CASCADE,
    pseudonym bytea NOT NULL CHECK (octet_length(pseudonym) = 32),
    PRIMARY KEY (day, pseudonym)
);
