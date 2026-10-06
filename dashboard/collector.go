package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/oschwald/maxminddb-golang"
)

var visitorPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var referrerPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
var pagePattern = regexp.MustCompile(`^/(?:blog/(?:[a-z0-9]+(?:-[a-z0-9]+)*/)?|)$`)
var bots = regexp.MustCompile(`(?i)(bot|crawler|spider|headless|curl|wget)`)

type recorder interface {
	Record(context.Context, Event, int64) error
}
type rate struct {
	Start time.Time
	Count int
}
type Collector struct {
	Store    recorder
	Catalog  map[string]string
	Origins  map[string]bool
	DailyCap int64
	Geo      *maxminddb.Reader
	GeoTime  time.Time
	mu       sync.Mutex
	rates    map[string]rate
	now      func() time.Time
}

func NewCollector(c Config, store recorder) (*Collector, error) {
	data, err := os.ReadFile(c.Catalog)
	if err != nil || len(data) > 256*1024 {
		return nil, errConfig
	}
	catalog := make(map[string]string)
	if json.Unmarshal(data, &catalog) != nil || len(catalog) == 0 || len(catalog) > 1000 {
		return nil, errConfig
	}
	for path, title := range catalog {
		if !pagePattern.MatchString(path) || len(path) > 200 || len(title) > 500 {
			return nil, errConfig
		}
	}
	out := &Collector{Store: store, Catalog: catalog, Origins: make(map[string]bool), DailyCap: c.DailyCap, rates: make(map[string]rate), now: time.Now}
	for _, origin := range c.Origins {
		out.Origins[origin] = true
	}
	if c.GeoDatabase != "" {
		out.Geo, err = maxminddb.Open(c.GeoDatabase)
		if err != nil {
			return nil, errors.New("geo_database_unavailable")
		}
		out.GeoTime = time.Unix(int64(out.Geo.Metadata.BuildEpoch), 0)
	}
	return out, nil
}

func (c *Collector) permit(ip string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	for key, value := range c.rates {
		if now.Sub(value.Start) >= time.Minute {
			delete(c.rates, key)
		}
	}
	r, exists := c.rates[ip]
	if !exists {
		if len(c.rates) >= 10000 {
			return false
		}
		r.Start = now
	}
	r.Count++
	c.rates[ip] = r
	return r.Count <= 60
}

func publicIP(ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	a = a.Unmap()
	if !a.IsGlobalUnicast() || a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(cidr).Contains(a) {
			return false
		}
	}
	return true
}

func (c *Collector) country(ip net.IP) string {
	if c.Geo == nil || c.now().Sub(c.GeoTime) > 35*24*time.Hour || !publicIP(ip) {
		return "Unknown"
	}
	var record struct {
		Country struct {
			Code string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if c.Geo.Lookup(ip, &record) != nil {
		log.Print("geo lookup unavailable")
		return "Unknown"
	}
	code := record.Country.Code
	if len(code) != 2 || code[0] < 'A' || code[0] > 'Z' || code[1] < 'A' || code[1] > 'Z' {
		return "Unknown"
	}
	return code
}

func (c *Collector) Handler() http.Handler {
	mux := http.NewServeMux()
	slots := make(chan struct{}, 16)
	mux.HandleFunc("/collect", func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !c.Origins[origin] {
			failure(w, 403, "origin_denied")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "POST")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(204)
			return
		}
		if r.Method != "POST" {
			failure(w, 405, "method_not_allowed")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			failure(w, 429, "collection_busy")
			return
		}
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			failure(w, 400, "invalid_client")
			return
		}
		ip := net.ParseIP(host)
		// Only the loopback reverse proxy may provide this overwritten header.
		if ip != nil && ip.IsLoopback() && r.Header.Get("X-Real-IP") != "" {
			ip = net.ParseIP(r.Header.Get("X-Real-IP"))
		}
		if ip == nil {
			failure(w, 400, "invalid_client")
			return
		}
		if !c.permit(ip.String()) {
			failure(w, 429, "rate_limit")
			return
		}
		var event Event
		if !decode(w, r, &event, 2048) {
			return
		}
		if _, exists := c.Catalog[event.Page]; !exists || (event.Visitor != "" && !visitorPattern.MatchString(event.Visitor)) ||
			len(event.Referrer) > 200 || (event.Referrer != "" && !referrerPattern.MatchString(event.Referrer)) {
			failure(w, 400, "invalid_event")
			return
		}
		originURL, _ := url.Parse(origin)
		if strings.HasSuffix(event.Referrer, ".nishad.ai") || event.Referrer == "nishad.ai" ||
			event.Referrer == originURL.Hostname() {
			event.Referrer = ""
		}
		if r.Header.Get("DNT") == "1" || r.Header.Get("Sec-GPC") == "1" || bots.MatchString(r.UserAgent()) {
			w.WriteHeader(204)
			return
		}
		event.Country = c.country(ip)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := c.Store.Record(ctx, event, c.DailyCap); err != nil {
			if errors.Is(err, errCap) {
				failure(w, 429, "collection_cap")
			} else {
				log.Print("collection storage unavailable")
				failure(w, 503, "collection_unavailable")
			}
			return
		}
		w.WriteHeader(204)
	})
	return secured(mux)
}
