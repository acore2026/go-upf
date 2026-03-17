package userspace

import (
	"errors"
	"testing"
	"time"
)

type stubIOBackend struct {
	started int
	writes  []PacketOutcome
	closed  int
	err     error
}

func (b *stubIOBackend) start(*Driver) {
	b.started++
}

func (b *stubIOBackend) write(outcome PacketOutcome) error {
	b.writes = append(b.writes, outcome)
	return b.err
}

func (b *stubIOBackend) close() {
	b.closed++
}

func TestRuntimeIODelegatesToBackend(t *testing.T) {
	backend := &stubIOBackend{}
	rio := &runtimeIO{backend: backend}

	rio.start(nil)
	if backend.started != 1 {
		t.Fatalf("expected backend start to be called once, got %d", backend.started)
	}

	driver := &Driver{io: rio}
	outcome := PacketOutcome{Action: PacketActionForward, Format: PayloadFormatRawIP}
	if err := driver.writeOutcome(outcome); err != nil {
		t.Fatalf("writeOutcome failed: %v", err)
	}
	if len(backend.writes) != 1 {
		t.Fatalf("expected one write, got %d", len(backend.writes))
	}

	rio.close()
	if backend.closed != 1 {
		t.Fatalf("expected backend close to be called once, got %d", backend.closed)
	}
}

func TestEgressLoopCountsBackendWriteErrors(t *testing.T) {
	driver := &Driver{
		stats:    newStatsTracker(),
		egressCh: make(chan PacketOutcome, 1),
		stopCh:   make(chan struct{}),
		io: &runtimeIO{backend: &stubIOBackend{
			err: errors.New("boom"),
		}},
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		driver.egressLoop()
	}()

	driver.egressCh <- PacketOutcome{Action: PacketActionForward, Format: PayloadFormatRawIP}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if driver.Stats().EgressErrors == 1 {
			close(driver.stopCh)
			<-done
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	close(driver.stopCh)
	<-done
	t.Fatal("expected egress error counter to increment")
}
