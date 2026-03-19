package forwarder

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/acore2026/go-upf/internal/report"
	"github.com/acore2026/go-upf/pkg/factory"
)

type fakeGtp5gDriver struct {
	link   *Gtp5gLink
	closed bool
}

func (d *fakeGtp5gDriver) Close()                         { d.closed = true }
func (d *fakeGtp5gDriver) CreatePDR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) UpdatePDR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) RemovePDR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) CreateFAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) UpdateFAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) RemoveFAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) CreateQER(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) UpdateQER(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) RemoveQER(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) CreateURR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) UpdateURR(uint64, *ie.IE) ([]report.USAReport, error) {
	return nil, nil
}
func (d *fakeGtp5gDriver) RemoveURR(uint64, *ie.IE) ([]report.USAReport, error) {
	return nil, nil
}
func (d *fakeGtp5gDriver) QueryURR(uint64, uint32) ([]report.USAReport, error) {
	return nil, nil
}
func (d *fakeGtp5gDriver) CreateBAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) UpdateBAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) RemoveBAR(uint64, *ie.IE) error { return nil }
func (d *fakeGtp5gDriver) HandleReport(report.Handler)    {}
func (d *fakeGtp5gDriver) Link() *Gtp5gLink               { return d.link }

func TestNewDriverRejectsNilGtp5gLink(t *testing.T) {
	cfg := &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "gtp5g",
			IfList: []factory.IfInfo{
				{Addr: "127.0.0.1"},
			},
		},
		DnnList: []factory.DnnList{
			{Dnn: "internet", Cidr: "10.60.0.0/24"},
		},
	}

	fake := &fakeGtp5gDriver{}
	prevOpenGtp5g := openGtp5g
	openGtp5g = func(*sync.WaitGroup, string, uint32) (gtp5gDriver, error) {
		return fake, nil
	}
	defer func() {
		openGtp5g = prevOpenGtp5g
	}()

	driver, err := NewDriver(&sync.WaitGroup{}, cfg)
	require.Nil(t, driver)
	require.EqualError(t, err, "gtp5g link is nil")
	require.True(t, fake.closed)
}

func TestNewDriverCreatesUserspaceBackend(t *testing.T) {
	driver, err := NewDriver(&sync.WaitGroup{}, &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   1,
				QueueSize: 8,
			},
		},
	})

	require.NoError(t, err)
	require.NotNil(t, driver)
	driver.Close()
}

func TestNewDriverCreatesUserspaceForwarder(t *testing.T) {
	cfg := &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   2,
				QueueSize: 8,
			},
		},
	}

	driver, err := NewDriver(&sync.WaitGroup{}, cfg)
	require.NoError(t, err)
	require.NotNil(t, driver)

	driver.Close()
}

func TestNewDriverSupportsUserspaceForwarder(t *testing.T) {
	cfg := &factory.Config{
		Gtpu: &factory.Gtpu{
			Forwarder: "userspace",
			Userspace: &factory.Userspace{
				Workers:   2,
				QueueSize: 128,
			},
		},
	}

	driver, err := NewDriver(&sync.WaitGroup{}, cfg)
	require.NoError(t, err)
	require.NotNil(t, driver)

	driver.Close()
}
