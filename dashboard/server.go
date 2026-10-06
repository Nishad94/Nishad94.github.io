package dashboard

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/*
var web embed.FS

type Server struct {
	Auth  *Auth
	Store *Store
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	performance := NewPerformance()
	mux.HandleFunc("GET /auth/login", s.Auth.Login)
	mux.HandleFunc("GET /auth/github/callback", s.Auth.Callback)
	mux.HandleFunc("POST /auth/logout", s.Auth.Require(s.Auth.Logout))
	mux.HandleFunc("GET /api/session", s.Auth.Require(func(w http.ResponseWriter, r *http.Request) {
		session, _ := s.Auth.Current(r, false)
		jsonReply(w, 200, map[string]string{"csrf": session.CSRF})
	}))
	mux.HandleFunc("POST /api/metrics", s.Auth.Require(performance.Measure(s.metrics)))
	mux.HandleFunc("GET /api/performance", s.Auth.Require(func(w http.ResponseWriter, r *http.Request) {
		jsonReply(w, 200, performance.Report())
	}))
	assets, _ := fs.Sub(web, "web")
	for _, path := range []string{"/", "/dashboard_metrics"} {
		pattern := "GET " + path
		if path == "/" {
			pattern += "{$}"
		}
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if _, ok := s.Auth.Current(r, false); !ok {
				http.Redirect(w, r, "/auth/login?next="+r.URL.Path, http.StatusSeeOther)
				return
			}
			body, _ := fs.ReadFile(assets, "index.html")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(body)
		})
	}
	for _, name := range []string{"app.js", "style.css", "world.json"} {
		mux.Handle("GET /"+name, s.Auth.Require(func(w http.ResponseWriter, r *http.Request) {
			http.FileServerFS(assets).ServeHTTP(w, r)
		}))
	}
	return secured(mux)
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Days int `json:"days"`
	}
	if !decode(w, r, &req, 100) {
		return
	}
	if req.Days < 1 || req.Days > 30 {
		failure(w, 400, "invalid_range")
		return
	}
	if s.Store == nil {
		failure(w, 503, "metrics_not_configured")
		return
	}
	report, err := s.Store.Report(r.Context(), req.Days)
	if _, ok := s.Auth.Current(r, false); !ok {
		failure(w, 401, "sign_in_required")
		return
	}
	if err != nil {
		failure(w, 503, "metrics_unavailable")
		return
	}
	jsonReply(w, 200, report)
}
