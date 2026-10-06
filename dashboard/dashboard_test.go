package dashboard

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func testServer(t *testing.T) (*Server, http.Handler, string) {
	t.Helper()
	auth := NewAuth(Config{Origin: "https://private.example", OwnerID: 123, ClientID: "synthetic", ClientSecret: "synthetic"})
	s := &Server{Auth: auth}
	token := randomToken()
	auth.sessions[sha256.Sum256([]byte(token))] = session{time.Now(), time.Now(), "csrf-fixture"}
	return s, s.Handler(), token
}

func authenticated(method, path, body, token string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://private.example")
	req.Header.Set("X-CSRF-Token", "csrf-fixture")
	return req
}

func TestOwnerAPIsAndSessionLifetime(t *testing.T) {
	s, handler, token := testServer(t)
	for _, endpoint := range []struct{ method, path string }{
		{"POST", "/api/metrics"}, {"GET", "/api/performance"}, {"GET", "/api/session"},
	} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader("{}")))
		if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d", endpoint.path, w.Code)
		}
	}
	for _, path := range []string{"/files", "/api/files", "/connector"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, authenticated("GET", path, "", token))
		if w.Code != 404 {
			t.Fatalf("removed capability %s: %d", path, w.Code)
		}
	}
	for _, header := range []string{"Origin", "X-CSRF-Token"} {
		req := authenticated("POST", "/api/metrics", `{"days":7}`, token)
		req.Header.Set(header, "invalid")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatal("invalid origin or CSRF admitted")
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, authenticated("GET", "/dashboard_metrics", "", token))
	if w.Code != 200 || strings.Contains(w.Body.String(), "analytics.js") || strings.Contains(w.Body.String(), "/files") {
		t.Fatal("private metrics shell")
	}
	s.Auth.now = func() time.Time { return time.Now().Add(29 * time.Minute) }
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, authenticated("GET", "/api/session", "", token))
	if w.Code != 200 {
		t.Fatal("session not live")
	}
	s.Auth.now = func() time.Time { return time.Now().Add(31 * time.Minute) }
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, authenticated("GET", "/api/session", "", token))
	if w.Code != 401 {
		t.Fatal("polling kept idle session alive")
	}
}

func TestGitHubCallbackPinsNumericOwner(t *testing.T) {
	for _, owner := range []int64{123, 999} {
		t.Run(map[bool]string{true: "owner", false: "stranger"}[owner == 123], func(t *testing.T) {
			oauthServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					r.ParseForm()
					if r.Form.Get("code_verifier") == "" {
						t.Error("no PKCE")
					}
					io.WriteString(w, `{"access_token":"synthetic","token_type":"bearer"}`)
				} else {
					json.NewEncoder(w).Encode(map[string]any{"id": owner, "login": "same-name"})
				}
			}))
			defer oauthServer.Close()
			a := NewAuth(Config{Origin: "https://private.example", OwnerID: 123, ClientID: "fixture", ClientSecret: "fixture"})
			a.oauth.Endpoint = oauth2.Endpoint{AuthURL: oauthServer.URL + "/authorize", TokenURL: oauthServer.URL + "/token", AuthStyle: oauth2.AuthStyleInParams}
			a.userURL = oauthServer.URL + "/user"
			start := httptest.NewRecorder()
			a.Login(start, httptest.NewRequest("GET", "/auth/login?next=/dashboard_metrics", nil))
			u, _ := url.Parse(start.Header().Get("Location"))
			if u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("scope") != "" {
				t.Fatal("OAuth scope/PKCE")
			}
			req := httptest.NewRequest("GET", "/auth/github/callback?code=fixture&state="+u.Query().Get("state"), nil)
			req.AddCookie(start.Result().Cookies()[0])
			result := httptest.NewRecorder()
			a.Callback(result, req)
			if owner != 123 {
				if result.Code != 403 || len(a.sessions) != 0 {
					t.Fatal("wrong owner admitted")
				}
			} else {
				if result.Code != 303 || result.Header().Get("Location") != "/dashboard_metrics" || len(a.sessions) != 1 {
					t.Fatal("owner denied")
				}
				for _, cookie := range result.Result().Cookies() {
					if !cookie.Secure || !cookie.HttpOnly || cookie.Domain != "" {
						t.Fatal("unsafe cookie")
					}
				}
			}
			replay := httptest.NewRecorder()
			a.Callback(replay, req)
			if replay.Code != 403 {
				t.Fatal("state replay")
			}
		})
	}
}

type recording struct {
	events []Event
	err    error
}

func (r *recording) Record(_ context.Context, e Event, _ int64) error {
	r.events = append(r.events, e)
	return r.err
}

func TestCollectorPrivacyAndBoundaries(t *testing.T) {
	rec := &recording{}
	c := &Collector{Store: rec, Catalog: map[string]string{"/": "Home"}, Origins: map[string]bool{"https://nishad.ai": true}, DailyCap: 100,
		rates: make(map[string]rate), now: time.Now}
	handler := c.Handler()
	send := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/collect", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://nishad.ai")
		req.Header.Set("X-Real-IP", "8.8.8.8")
		req.Header.Set("CF-IPCountry", "US")
		req.RemoteAddr = "192.0.2.1:3000"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	for _, body := range []string{
		`{"page":"/?token=secret","referrer":""}`, `{"page":"/","referrer":"https://example.com/path?secret=value"}`,
		`{"page":"/","referrer":"","userAgent":"secret"}`, `{"page":"/","referrer":"","country":"US"}`,
		`{"page":"/files","referrer":""}`, `{"page":"/","referrer":"","visitor":"real-email@example.com"}`,
	} {
		if send(body).Code != 400 {
			t.Errorf("accepted %s", body)
		}
	}
	if send(`{"page":"/","referrer":"private.nishad.ai"}`).Code != 204 || len(rec.events) != 1 {
		t.Fatal("valid event")
	}
	if rec.events[0].Country != "Unknown" || rec.events[0].Referrer != "" {
		t.Fatal("metadata leaked")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/metrics", nil))
	if w.Code != 404 {
		t.Fatal("public reporting")
	}
	for _, raw := range []string{"127.0.0.1", "10.1.2.3", "100.64.0.1", "192.0.2.1", "::1", "2001:db8::1"} {
		if publicIP(net.ParseIP(raw)) {
			t.Errorf("reserved IP %s", raw)
		}
	}
}
