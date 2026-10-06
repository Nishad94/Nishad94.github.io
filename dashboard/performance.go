package dashboard

import (
	"math"
	"net/http"
	"sort"
	"sync"
	"time"
)

const performanceCapacity = 2048
const performanceWindow = 15 * time.Minute

type measurement struct {
	at     time.Time
	ms     float64
	failed bool
}

type Performance struct {
	mu      sync.Mutex
	samples []measurement
	now     func() time.Time
}

type PerformanceReport struct {
	Samples       int     `json:"samples"`
	Errors        int     `json:"errors"`
	AvgMS         float64 `json:"avgMs"`
	P95MS         float64 `json:"p95Ms"`
	P99MS         float64 `json:"p99Ms"`
	WindowMinutes int     `json:"windowMinutes"`
	Capacity      int     `json:"capacity"`
}

func NewPerformance() *Performance {
	return &Performance{now: time.Now}
}

func (p *Performance) prune(now time.Time) {
	first := 0
	for first < len(p.samples) && now.Sub(p.samples[first].at) >= performanceWindow {
		first++
	}
	p.samples = p.samples[first:]
}

func (p *Performance) record(ms float64, failed bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	p.prune(now)
	if len(p.samples) >= performanceCapacity {
		p.samples = p.samples[1:]
	}
	p.samples = append(p.samples, measurement{now, ms, failed})
}

func (p *Performance) Report() PerformanceReport {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(p.now())
	result := PerformanceReport{Samples: len(p.samples), WindowMinutes: 15, Capacity: performanceCapacity}
	if result.Samples == 0 {
		return result
	}
	values := make([]float64, len(p.samples))
	for i, sample := range p.samples {
		values[i] = sample.ms
		result.AvgMS += sample.ms
		if sample.failed {
			result.Errors++
		}
	}
	result.AvgMS /= float64(result.Samples)
	sort.Float64s(values)
	result.P95MS = values[int(math.Ceil(.95*float64(len(values))))-1]
	result.P99MS = values[int(math.Ceil(.99*float64(len(values))))-1]
	return result
}

type responseStatus struct {
	http.ResponseWriter
	status int
}

func (w *responseStatus) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *responseStatus) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

// Measure only authenticated data operations, never file selectors or identity.
func (p *Performance) Measure(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		status := &responseStatus{ResponseWriter: w}
		next(status, r)
		p.record(float64(time.Since(start))/float64(time.Millisecond), status.status >= 400)
	}
}
