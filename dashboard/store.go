package dashboard

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

var errCap = errors.New("collection_cap")

type Store struct {
	DB *pgxpool.Pool
}

func OpenStore(ctx context.Context, connection string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(connection)
	if err != nil {
		return nil, errConfig
	}
	cfg.MaxConns = 4
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "5000"
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, errConfig
	}
	if db.Ping(ctx) != nil {
		db.Close()
		return nil, errors.New("database_unavailable")
	}
	return &Store{db}, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, schema)
	return err
}

func (s *Store) Maintain(ctx context.Context) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, sql := range []string{
		"DELETE FROM metrics.visitors WHERE day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date",
		"DELETE FROM metrics.daily_keys WHERE day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date",
		"DELETE FROM metrics.days WHERE day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29",
	} {
		if _, err = tx.Exec(ctx, sql); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) Purge(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, "TRUNCATE metrics.visitors, metrics.daily_keys, metrics.buckets, metrics.days")
	return err
}

type Event struct {
	Page     string `json:"page"`
	Referrer string `json:"referrer"`
	Visitor  string `json:"visitor,omitempty"`
	Country  string `json:"-"`
}

func (s *Store) Record(ctx context.Context, e Event, cap int64) error {
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var day time.Time
	if err = tx.QueryRow(ctx, "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date").Scan(&day); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO metrics.days(day) VALUES($1) ON CONFLICT DO NOTHING", day); err != nil {
		return err
	}
	var views int64
	if err = tx.QueryRow(ctx, "SELECT views FROM metrics.days WHERE day=$1 FOR UPDATE", day).Scan(&views); err != nil {
		return err
	}
	if views >= cap {
		return errCap
	}
	unique, unidentified, unknown := 0, 0, 0
	if e.Visitor == "" {
		unidentified = 1
	} else {
		key := make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO metrics.daily_keys(day,key) VALUES($1,$2) ON CONFLICT DO NOTHING", day, key); err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, "SELECT key FROM metrics.daily_keys WHERE day=$1", day).Scan(&key); err != nil {
			return err
		}
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(e.Visitor))
		tag, err := tx.Exec(ctx, "INSERT INTO metrics.visitors(day,pseudonym) VALUES($1,$2) ON CONFLICT DO NOTHING", day, mac.Sum(nil))
		if err != nil {
			return err
		}
		unique = int(tag.RowsAffected())
	}
	if e.Country == "Unknown" {
		unknown = 1
	}
	if _, err = tx.Exec(ctx, `UPDATE metrics.days SET views=views+1, uniques=uniques+$2,
		unidentified=unidentified+$3, unknown_country=unknown_country+$4 WHERE day=$1`,
		day, unique, unidentified, unknown); err != nil {
		return err
	}
	for kind, label := range map[string]string{"page": e.Page, "referrer": e.Referrer, "country": e.Country} {
		if label == "" {
			label = "Direct / unknown"
		}
		if _, err = tx.Exec(ctx, `INSERT INTO metrics.buckets(day,kind,label,views) VALUES($1,$2,$3,1)
			ON CONFLICT(day,kind,label) DO UPDATE SET views=metrics.buckets.views+1`, day, kind, label); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type Daily struct {
	Day     string `json:"day"`
	Views   int64  `json:"views"`
	Uniques int64  `json:"uniques"`
}
type Bucket struct {
	Label string `json:"label"`
	Views int64  `json:"views"`
}
type Report struct {
	Views          int64    `json:"views"`
	Uniques        int64    `json:"uniques"`
	Unidentified   int64    `json:"unidentified"`
	UnknownCountry int64    `json:"unknownCountry"`
	Daily          []Daily  `json:"daily"`
	Pages          []Bucket `json:"pages"`
	Referrers      []Bucket `json:"referrers"`
	Countries      []Bucket `json:"countries"`
}

func (s *Store) Report(ctx context.Context, days int) (Report, error) {
	out := Report{Daily: []Daily{}, Pages: []Bucket{}, Referrers: []Bucket{}, Countries: []Bucket{}}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT day::text,views,uniques,unidentified,unknown_country FROM metrics.days
		WHERE day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - ($1::int - 1) ORDER BY day`, days)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var d Daily
		var noID, unknown int64
		if err = rows.Scan(&d.Day, &d.Views, &d.Uniques, &noID, &unknown); err != nil {
			rows.Close()
			return out, err
		}
		out.Daily = append(out.Daily, d)
		out.Views += d.Views
		out.Uniques += d.Uniques
		out.Unidentified += noID
		out.UnknownCountry += unknown
	}
	rows.Close()
	if rows.Err() != nil {
		return out, rows.Err()
	}
	for kind, target := range map[string]*[]Bucket{"page": &out.Pages, "referrer": &out.Referrers, "country": &out.Countries} {
		minimum := 5
		if kind == "page" {
			minimum = 1
		}
		rows, err = tx.Query(ctx, `SELECT label,sum(views)::bigint FROM metrics.buckets
			WHERE day >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - ($1::int - 1) AND kind=$2
			GROUP BY label HAVING sum(views)>=$3 ORDER BY sum(views) DESC,label LIMIT 100`, days, kind, minimum)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var b Bucket
			if err = rows.Scan(&b.Label, &b.Views); err != nil {
				rows.Close()
				return out, err
			}
			*target = append(*target, b)
		}
		rows.Close()
		if rows.Err() != nil {
			return out, rows.Err()
		}
	}
	return out, tx.Commit(ctx)
}
