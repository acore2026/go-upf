package app

import (
	"testing"
	"time"

	"github.com/free5gc/go-upf/pkg/factory"
)

func TestStartReturnsWhenDriverInitializationFails(t *testing.T) {
	cfg := &factory.Config{
		Version: "1.0.3",
		Pfcp: &factory.Pfcp{
			Addr:   "127.0.0.1",
			NodeID: "127.0.0.1",
		},
		Gtpu: &factory.Gtpu{
			Forwarder: "unsupported",
			IfList: []factory.IfInfo{
				{Addr: "127.0.0.1"},
			},
		},
		DnnList: []factory.DnnList{
			{
				Dnn:  "internet",
				Cidr: "10.60.0.1/24",
			},
		},
		Logger: &factory.Logger{
			Enable: true,
			Level:  "info",
		},
	}

	upf, err := NewApp(cfg)
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		upf.Start()
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return after driver initialization failure")
	}
}
