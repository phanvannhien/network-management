package api

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
)

// SessionCookie is the name of the HttpOnly session cookie.
const SessionCookie = "ntb_session"

type ctxKey int

const (
	ctxMeta ctxKey = iota
	ctxSession
)

// requestInfo is request metadata handlers need but the generated strict interface does not pass.
type requestInfo struct {
	meta   auth.RequestMeta
	secure bool // original request was HTTPS (sets the cookie Secure flag)
}

func infoFrom(ctx context.Context) requestInfo {
	info, _ := ctx.Value(ctxMeta).(requestInfo)
	return info
}

func sessionFrom(ctx context.Context) (auth.Session, bool) {
	s, ok := ctx.Value(ctxSession).(auth.Session)
	return s, ok
}

// withRequestInfo resolves the client IP via trusted proxies and stores request metadata.
func withRequestInfo(resolver *auth.ClientIPResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			info := requestInfo{
				meta: auth.RequestMeta{
					IP:        resolver.Resolve(r),
					UserAgent: r.UserAgent(),
					RequestID: middleware.GetReqID(r.Context()),
				},
				secure: resolver.IsSecure(r),
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxMeta, info)))
		})
	}
}

// withSession loads the session from the cookie (if any). Endpoints decide whether one is required.
func withSession(svc *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(SessionCookie)
			if err == nil && cookie.Value != "" {
				sess, err := svc.Lookup(r.Context(), cookie.Value)
				if err == nil {
					r = r.WithContext(context.WithValue(r.Context(), ctxSession, sess))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// csrfGuard protects state-changing requests (SRS §14):
//   - rejects cross-site requests outright (Sec-Fetch-Site / Origin vs Host), which also blocks login CSRF;
//   - for authenticated requests, requires X-CSRF-Token to match the session's token.
func csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSafeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || !sameOrigin(r) {
			writeError(w, http.StatusForbidden, "Yêu cầu bị chặn: khác nguồn gốc (CSRF)")
			return
		}
		if sess, ok := sessionFrom(r.Context()); ok && r.URL.Path != "/api/auth/login" {
			got := r.Header.Get("X-CSRF-Token")
			if subtle.ConstantTimeCompare([]byte(got), []byte(sess.CSRFToken)) != 1 {
				writeError(w, http.StatusForbidden, "CSRF token không hợp lệ")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// sameOrigin accepts requests without an Origin header (non-browser clients, same-origin GETs)
// and requests whose Origin host matches the Host header the browser targeted.
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Host == r.Host
}
