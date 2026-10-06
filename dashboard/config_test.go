package dashboard

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateConfigurationBoundaries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := Config{Mode: "dashboard", Origin: "https://private.example", OwnerID: 123,
		ClientID: "fixture", ClientSecret: "fixture-secret", DatabaseURL: "postgres:///synthetic"}
	save := func(mode os.FileMode) {
		t.Helper()
		if err := os.Chmod(path, 0600); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		data, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
	}
	save(0600)
	if _, err := LoadConfig(path); err != nil {
		t.Fatal("private config rejected")
	}
	for _, mode := range []os.FileMode{0644, 0640, 0440} {
		save(mode)
		if _, err := LoadConfig(path); err == nil {
			t.Fatal("non-private config accepted outside systemd mount")
		}
	}
	save(0600)
	cfg.ClientSecret = ""
	save(0600)
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("missing OAuth secret accepted")
	}
	cfg.ClientSecret = "fixture-secret"
	cfg.Mode = "connector"
	save(0600)
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("removed connector mode accepted")
	}
	cfg.Mode = "dashboard"
	cfg.Listen = "0.0.0.0:8090"
	save(0600)
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("public listener accepted")
	}
}
