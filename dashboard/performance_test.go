package dashboard

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPerformancePercentilesAndExpiry(t *testing.T) {
	p := NewPerformance()
	now := time.Now()
	p.now = func() time.Time { return now }
	if p.Report().Samples != 0 {
		t.Fatal("fabricated empty samples")
	}
	for i := 1; i <= 100; i++ {
		p.record(float64(i), i <= 3)
	}
	r := p.Report()
	if r.AvgMS != 50.5 || r.P95MS != 95 || r.P99MS != 99 || r.Errors != 3 || r.Samples != 100 {
		t.Fatalf("incorrect percentiles: %+v", r)
	}
	now = now.Add(performanceWindow)
	if p.Report().Samples != 0 {
		t.Fatal("window did not expire")
	}
	for i := 0; i < performanceCapacity+10; i++ {
		p.record(20, false)
	}
	if p.Report().Samples != performanceCapacity {
		t.Fatal("unbounded measurements")
	}
}

func TestPerformanceHTTPStatus(t *testing.T) {
	p := NewPerformance()
	p.Measure(func(w http.ResponseWriter, r *http.Request) { failure(w, 503, "metrics_unavailable") })(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/metrics", nil))
	if r := p.Report(); r.Samples != 1 || r.Errors != 1 || r.AvgMS < 0 {
		t.Fatalf("%+v", r)
	}
	_, handler, token := testServer(t)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/performance", nil))
	if w.Code != 401 {
		t.Fatal("public performance data")
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, authenticated("GET", "/api/performance", "", token))
	if w.Code != 200 {
		t.Fatal("owner cannot view performance")
	}
}
