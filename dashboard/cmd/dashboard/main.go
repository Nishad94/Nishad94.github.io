package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nishad.ai/dashboard"
)

func main() {
	config := flag.String("config", "", "absolute path to private mode-0600 configuration")
	confirmPurge := flag.Bool("confirm-purge", false, "explicitly authorize analytics-only data deletion")
	flag.Parse()
	c, err := dashboard.LoadConfig(*config)
	if err != nil {
		log.Fatal("configuration unavailable or invalid")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var store *dashboard.Store
	if c.DatabaseURL != "" {
		store, err = dashboard.OpenStore(ctx, c.DatabaseURL)
		if err != nil {
			log.Fatal("database unavailable")
		}
		defer store.DB.Close()
	}
	switch c.Mode {
	case "migrate":
		err = store.Migrate(ctx)
	case "maintain":
		err = store.Maintain(ctx)
	case "purge":
		if !*confirmPurge {
			log.Fatal("analytics purge requires --confirm-purge")
		}
		err = store.Purge(ctx)
	default:
		var handler http.Handler
		if c.Mode == "collector" {
			if store.Maintain(ctx) != nil {
				log.Fatal("retention maintenance failed; collection not started")
			}
			go func() {
				ticker := time.NewTicker(time.Hour)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						if store.Maintain(ctx) != nil {
							log.Print("retention maintenance failed; stopping collection")
							cancel()
							return
						}
					}
				}
			}()
			collector, e := dashboard.NewCollector(c, store)
			if e != nil {
				log.Fatal("collector configuration unavailable")
			}
			if collector.Geo != nil {
				defer collector.Geo.Close()
			}
			handler = collector.Handler()
		} else {
			handler = (&dashboard.Server{Auth: dashboard.NewAuth(c), Store: store}).Handler()
		}
		server := dashboard.HTTPServer(c.Listen, handler)
		go func() {
			<-ctx.Done()
			shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			server.Shutdown(shutdown)
		}()
		log.Print("service listening on configured loopback address")
		err = server.ListenAndServe()
		if err == http.ErrServerClosed {
			err = nil
		}
	}
	if err != nil {
		log.Fatal("operation failed; inspect sanitized service status")
	}
}
