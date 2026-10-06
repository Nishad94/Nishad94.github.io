package dashboard

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const sessionCookie = "__Host-dashboard"
const loginCookie = "__Host-dashboard-login"

type session struct {
	Created time.Time
	Used    time.Time
	CSRF    string
}

type pendingLogin struct {
	Created  time.Time
	Verifier string
	Target   string
}

type Auth struct {
	mu       sync.Mutex
	origin   string
	owner    int64
	oauth    oauth2.Config
	client   *http.Client
	sessions map[[32]byte]session
	pending  map[[32]byte]pendingLogin
	userURL  string
	now      func() time.Time
}

func NewAuth(c Config) *Auth {
	return &Auth{
		origin: c.Origin, owner: c.OwnerID, client: &http.Client{Timeout: 10 * time.Second},
		oauth: oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret,
			RedirectURL: c.Origin + "/auth/github/callback", Endpoint: github.Endpoint},
		sessions: make(map[[32]byte]session), pending: make(map[[32]byte]pendingLogin),
		userURL: "https://api.github.com/user", now: time.Now,
	}
}

func randomToken() string {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic("secure randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(bytes[:])
}

func cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: age,
		Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func (a *Auth) cleanup() {
	now := a.now()
	for key, value := range a.pending {
		if now.Sub(value.Created) > 10*time.Minute {
			delete(a.pending, key)
		}
	}
	for key, value := range a.sessions {
		if now.Sub(value.Created) > 8*time.Hour || now.Sub(value.Used) > 30*time.Minute {
			delete(a.sessions, key)
		}
	}
}

func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	target := "/dashboard_metrics"
	state, verifier := randomToken(), oauth2.GenerateVerifier()
	a.mu.Lock()
	a.cleanup()
	if len(a.pending) >= 128 {
		a.mu.Unlock()
		failure(w, 429, "login_limit")
		return
	}
	a.pending[sha256.Sum256([]byte(state))] = pendingLogin{a.now(), verifier, target}
	a.mu.Unlock()
	cookie(w, loginCookie, state, 600)
	http.Redirect(w, r, a.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

func (a *Auth) Callback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(loginCookie)
	state := r.URL.Query().Get("state")
	if err != nil || len(state) != 43 || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		failure(w, 403, "invalid_login")
		return
	}
	key := sha256.Sum256([]byte(state))
	a.mu.Lock()
	a.cleanup()
	pending, ok := a.pending[key]
	delete(a.pending, key)
	a.mu.Unlock()
	cookie(w, loginCookie, "", -1)
	if !ok || r.URL.Query().Get("code") == "" {
		failure(w, 403, "invalid_login")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = context.WithValue(ctx, oauth2.HTTPClient, a.client)
	token, err := a.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(pending.Verifier))
	if err != nil {
		failure(w, 502, "identity_unavailable")
		return
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", a.userURL, nil)
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := a.client.Do(req)
	if err != nil {
		failure(w, 502, "identity_unavailable")
		return
	}
	defer res.Body.Close()
	var user struct {
		ID int64 `json:"id"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 64*1024)).Decode(&user) != nil {
		failure(w, 502, "identity_unavailable")
		return
	}
	if user.ID != a.owner {
		failure(w, 403, "owner_only")
		return
	}
	raw := randomToken()
	a.mu.Lock()
	a.cleanup()
	if len(a.sessions) >= 32 {
		a.mu.Unlock()
		failure(w, 429, "session_limit")
		return
	}
	if old, err := r.Cookie(sessionCookie); err == nil {
		delete(a.sessions, sha256.Sum256([]byte(old.Value)))
	}
	a.sessions[sha256.Sum256([]byte(raw))] = session{a.now(), a.now(), randomToken()}
	a.mu.Unlock()
	cookie(w, sessionCookie, raw, 8*60*60)
	http.Redirect(w, r, pending.Target, http.StatusSeeOther)
}

func (a *Auth) Current(r *http.Request, touch bool) (session, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || len(c.Value) != 43 {
		return session{}, false
	}
	key := sha256.Sum256([]byte(c.Value))
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cleanup()
	s, ok := a.sessions[key]
	if ok && touch {
		s.Used = a.now()
		a.sessions[key] = s
	}
	return s, ok
}

func (a *Auth) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, ok := a.Current(r, r.URL.Path != "/api/session")
		if !ok {
			failure(w, 401, "sign_in_required")
			return
		}
		if r.Method == "POST" && (r.Header.Get("Origin") != a.origin ||
			subtle.ConstantTimeCompare([]byte(s.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1) {
			failure(w, 403, "request_not_allowed")
			return
		}
		next(w, r)
	}
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(sessionCookie)
	a.mu.Lock()
	delete(a.sessions, sha256.Sum256([]byte(c.Value)))
	a.mu.Unlock()
	cookie(w, sessionCookie, "", -1)
	jsonReply(w, 200, map[string]bool{"loggedOut": true})
}
