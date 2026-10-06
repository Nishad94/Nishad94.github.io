package dashboard

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

var errConfig = errors.New("invalid private configuration")

type Config struct {
	Mode         string   `json:"mode"`
	Listen       string   `json:"listen"`
	Origin       string   `json:"origin"`
	OwnerID      int64    `json:"ownerId"`
	ClientID     string   `json:"clientId"`
	ClientSecret string   `json:"clientSecret"`
	DatabaseURL  string   `json:"databaseUrl"`
	Catalog      string   `json:"catalog"`
	GeoDatabase  string   `json:"geoDatabase"`
	Origins      []string `json:"origins"`
	DailyCap     int64    `json:"dailyCap"`
}

// Configuration is deliberately not loaded from the public checkout or environment.
func LoadConfig(path string) (Config, error) {
	var cfg Config
	if !filepath.IsAbs(path) {
		return cfg, errConfig
	}
	f, err := os.Open(path)
	if err != nil {
		return cfg, errConfig
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 64*1024 {
		return cfg, errConfig
	}
	privateMode := info.Mode().Perm()&0077 == 0
	// systemd exposes credentials as 0440 inside the unit's private credential mount.
	credentialDir := os.Getenv("CREDENTIALS_DIRECTORY")
	systemCredential := strings.HasPrefix(credentialDir, "/run/credentials/") &&
		path == filepath.Join(credentialDir, "config") && info.Mode().Perm() == 0440
	if !privateMode && !systemCredential {
		return cfg, errConfig
	}
	d := json.NewDecoder(io.LimitReader(f, 64*1024))
	d.DisallowUnknownFields()
	if d.Decode(&cfg) != nil || d.Decode(new(any)) != io.EOF {
		return cfg, errConfig
	}
	if cfg.Listen == "" {
		cfg.Listen = "127.0.0.1:8090"
	}
	host, _, err := net.SplitHostPort(cfg.Listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return cfg, errConfig
	}
	if cfg.DailyCap == 0 {
		cfg.DailyCap = 10000
	}
	if cfg.DailyCap < 1 || cfg.DailyCap > 1000000 {
		return cfg, errConfig
	}
	switch cfg.Mode {
	case "dashboard":
		if !httpsOrigin(cfg.Origin) || cfg.OwnerID <= 0 || cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.DatabaseURL == "" {
			return cfg, errConfig
		}
	case "collector":
		if cfg.DatabaseURL == "" || cfg.Catalog == "" || len(cfg.Origins) == 0 {
			return cfg, errConfig
		}
		for _, origin := range cfg.Origins {
			if !httpsOrigin(origin) {
				return cfg, errConfig
			}
		}
	case "migrate", "maintain", "purge":
		if cfg.DatabaseURL == "" {
			return cfg, errConfig
		}
	default:
		return cfg, errConfig
	}
	return cfg, nil
}

func httpsOrigin(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Path == "" &&
		u.RawQuery == "" && u.Fragment == "" && !strings.ContainsAny(raw, "\r\n")
}
