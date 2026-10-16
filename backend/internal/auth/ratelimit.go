package auth

import (
	"sync"
	"time"
)

// RateLimiter is a fixed-window counter keyed by string (IP, email). It is in-memory, which fits the
// single-binary deployment (ADR-004); a restart simply resets the windows.
type RateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	hits   map[string]*window
}

type window struct {
	start time.Time
	count int
}

// NewRateLimiter allows `limit` events per key per `period`.
func NewRateLimiter(limit int, period time.Duration) *RateLimiter {
	return &RateLimiter{limit: limit, window: period, now: time.Now, hits: map[string]*window{}}
}

// Allow records an event for key and reports whether it is within the limit.
func (r *RateLimiter) Allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	w, ok := r.hits[key]
	if !ok || now.Sub(w.start) >= r.window {
		r.hits[key] = &window{start: now, count: 1}
		r.gcLocked(now)
		return true
	}
	w.count++
	return w.count <= r.limit
}

// gcLocked drops expired windows so the map cannot grow without bound.
func (r *RateLimiter) gcLocked(now time.Time) {
	if len(r.hits) < 1024 {
		return
	}
	for k, w := range r.hits {
		if now.Sub(w.start) >= r.window {
			delete(r.hits, k)
		}
	}
}
