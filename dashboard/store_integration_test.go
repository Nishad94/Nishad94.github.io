package dashboard

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

func TestPostgresCountersRetentionAndPurge(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := uint32(listener.Addr().(*net.TCPAddr).Port)
	listener.Close()
	dir := t.TempDir()
	db := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V17).Port(port).Database("synthetic").Username("synthetic").
		Password("synthetic-test-only").RuntimePath(filepath.Join(dir, "runtime")).
		DataPath(filepath.Join(dir, "data")).BinariesPath(filepath.Join(dir, "bin")).
		CachePath(filepath.Join(dir, "cache")).StartTimeout(45 * time.Second))
	if err = db.Start(); err != nil {
		t.Fatalf("synthetic PostgreSQL: %v", err)
	}
	defer db.Stop()
	ctx := context.Background()
	store, err := OpenStore(ctx, "postgres://synthetic:synthetic-test-only@127.0.0.1:"+strconv.Itoa(int(port))+"/synthetic?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	if err = store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := store.Record(ctx, Event{Page: "/blog/synthetic/", Referrer: "example.com", Country: "Unknown", Visitor: strings.Repeat("a", 64)}, 100); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if err = store.Record(ctx, Event{Page: "/", Country: "Unknown"}, 100); err != nil {
		t.Fatal(err)
	}
	report, err := store.Report(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if report.Views != 21 || report.Uniques != 1 || report.Unidentified != 1 || report.UnknownCountry != 21 {
		t.Fatalf("unexpected totals: %+v", report)
	}
	if len(report.Referrers) != 1 || report.Referrers[0].Label != "example.com" {
		t.Fatal("small buckets not suppressed")
	}
	if err = store.Record(ctx, Event{Page: "/", Country: "Unknown"}, 21); err != errCap {
		t.Fatal("daily cap not enforced")
	}
	if _, err = store.DB.Exec(ctx, `INSERT INTO metrics.days(day,views) VALUES(CURRENT_DATE - 40,5);
		INSERT INTO metrics.daily_keys(day,key) VALUES(CURRENT_DATE - 40,decode(repeat('01',32),'hex'));
		INSERT INTO metrics.visitors(day,pseudonym) VALUES(CURRENT_DATE - 40,decode(repeat('02',32),'hex'));
		INSERT INTO metrics.buckets(day,kind,label,views) VALUES(CURRENT_DATE - 40,'page','/old/',5);`); err != nil {
		t.Fatal(err)
	}
	if err = store.Maintain(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = store.DB.QueryRow(ctx, "SELECT count(*) FROM metrics.days WHERE day < CURRENT_DATE - 29").Scan(&count); err != nil || count != 0 {
		t.Fatal("retention did not delete old rows")
	}
	if err = store.DB.QueryRow(ctx, "SELECT count(*) FROM metrics.visitors").Scan(&count); err != nil || count != 1 {
		t.Fatal("deduplication storage")
	}
	// Aggregate-only backup/restore does not carry short-lived visitor keys.
	backup, err := store.Report(ctx, 30)
	if err != nil {
		t.Fatal(err)
	}
	type savedBucket struct {
		Kind  string
		Label string
		Views int64
	}
	var saved []savedBucket
	rows, err := store.DB.Query(ctx, "SELECT kind,label,views FROM metrics.buckets WHERE day=CURRENT_DATE")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var b savedBucket
		if err = rows.Scan(&b.Kind, &b.Label, &b.Views); err != nil {
			t.Fatal(err)
		}
		saved = append(saved, b)
	}
	rows.Close()
	if rows.Err() != nil {
		t.Fatal(rows.Err())
	}
	if err = store.Purge(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(ctx, "INSERT INTO metrics.days(day,views,uniques,unidentified,unknown_country) VALUES(CURRENT_DATE,$1,$2,$3,$4)", backup.Views, backup.Uniques, backup.Unidentified, backup.UnknownCountry); err != nil {
		t.Fatal(err)
	}
	for _, b := range saved {
		if _, err = store.DB.Exec(ctx, "INSERT INTO metrics.buckets(day,kind,label,views) VALUES(CURRENT_DATE,$1,$2,$3)", b.Kind, b.Label, b.Views); err != nil {
			t.Fatal(err)
		}
	}
	if err = store.Maintain(ctx); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Report(ctx, 1)
	if err != nil || restored.Views != 21 || restored.Uniques != 1 {
		t.Fatal("aggregate restore failed")
	}
	if err = store.DB.QueryRow(ctx, "SELECT count(*) FROM metrics.visitors").Scan(&count); err != nil || count != 0 {
		t.Fatal("restored visitor identifiers")
	}
	if err = store.Purge(ctx); err != nil {
		t.Fatal(err)
	}
	empty, err := store.Report(ctx, 30)
	if err != nil || empty.Views != 0 || len(empty.Pages) != 0 {
		t.Fatal("purge failed")
	}
	t.Run("production role boundaries", func(t *testing.T) {
		if _, err := store.DB.Exec(ctx, `CREATE ROLE "nishad-report"; CREATE ROLE "nishad-collect";`); err != nil {
			t.Fatal(err)
		}
		grants, err := os.ReadFile("deploy/roles.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.DB.Exec(ctx, strings.ReplaceAll(string(grants), "DATABASE nishad_metrics", "DATABASE synthetic")); err != nil {
			t.Fatal(err)
		}
		base := store.DB.Config().ConnConfig.ConnString()
		reporter, err := OpenStore(ctx, base+"&role=nishad-report")
		if err != nil {
			t.Fatal(err)
		}
		defer reporter.DB.Close()
		collector, err := OpenStore(ctx, base+"&role=nishad-collect")
		if err != nil {
			t.Fatal(err)
		}
		defer collector.DB.Close()
		if err := collector.Record(ctx, Event{Page: "/", Country: "Unknown"}, 100); err != nil {
			t.Fatal("collector cannot aggregate", err)
		}
		if result, err := reporter.Report(ctx, 1); err != nil || result.Views != 1 {
			t.Fatal("report role cannot read aggregates", err)
		}
		for _, sql := range []string{"SELECT * FROM metrics.visitors", "SELECT * FROM metrics.daily_keys",
			"DELETE FROM metrics.days", "CREATE TABLE metrics.forbidden(id int)"} {
			if _, err := reporter.DB.Exec(ctx, sql); err == nil {
				t.Fatal("report role allowed", sql)
			}
		}
		for _, sql := range []string{"CREATE TABLE metrics.forbidden(id int)", "CREATE TABLE public.forbidden(id int)",
			"TRUNCATE metrics.days CASCADE"} {
			if _, err := collector.DB.Exec(ctx, sql); err == nil {
				t.Fatal("collector role allowed", sql)
			}
		}
		if err := collector.Maintain(ctx); err != nil {
			t.Fatal("collector cannot expire data", err)
		}
	})
}
