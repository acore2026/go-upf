package processor

import (
	"testing"

	upf_context "github.com/acore2026/go-upf/internal/context"
	sbimodels "github.com/acore2026/go-upf/internal/sbi/models"
	"github.com/acore2026/go-upf/pkg/factory"
	openapimodels "github.com/acore2026/openapi/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateSubscriptionRejectsUnsupportedQosMonitoring(t *testing.T) {
	initTestContext()
	p := New()

	rsp, problem := p.CreateSubscription(sbimodels.CreateEventSubscription{
		Subscription: validSubscription(),
	})

	require.Nil(t, rsp)
	require.NotNil(t, problem)
	assert.Equal(t, int32(501), problem.Status)
	assert.Equal(t, "QOS_MONITORING_PARAM_NOT_SUPPORTED", problem.Cause)
}

func TestSubscriptionCRUD(t *testing.T) {
	initTestContext()
	p := New()

	subscription := &sbimodels.EventSubscription{
		EventNotifyURI: "https://callback.example.com/notify",
		EventList: []sbimodels.Event{{
			Type: sbimodels.EventTypeQosMonitoring,
			QosMon: &openapimodels.QosMonitoringData{
				ReqQosMonParams: []openapimodels.RequestedQosMonitoringParameter{},
			},
		}},
	}

	// Store a subscription directly to exercise query/modify/delete paths
	record := upf_context.GetSelf().SaveSubscription(subscription)

	found, problem := p.GetSubscription(record.ID)
	require.Nil(t, problem)
	require.NotNil(t, found)
	assert.Equal(t, record.ID, found.ID)

	modified := &sbimodels.EventSubscription{
		EventNotifyURI: "https://callback.example.com/changed",
		EventList: []sbimodels.Event{{
			Type: sbimodels.EventTypeQosMonitoring,
			QosMon: &openapimodels.QosMonitoringData{
				ReqQosMonParams: []openapimodels.RequestedQosMonitoringParameter{
					openapimodels.RequestedQosMonitoringParameter_DOWNLINK,
				},
			},
		}},
	}
	updated, problem := p.ModifySubscription(record.ID, sbimodels.ModifySubscriptionRequest{Subscription: modified})
	require.Nil(t, updated)
	require.NotNil(t, problem)
	assert.Equal(t, int32(501), problem.Status)

	problem = p.DeleteSubscription(record.ID)
	require.Nil(t, problem)

	_, problem = p.GetSubscription(record.ID)
	require.NotNil(t, problem)
	assert.Equal(t, int32(404), problem.Status)
}

func initTestContext() {
	cfg := &factory.Config{
		Version: "1.0.3",
		NrfURI:  "https://127.0.0.10:8000",
		Sbi: &factory.Sbi{
			Scheme:       "http",
			RegisterIPv4: "127.0.0.8",
			BindingIPv4:  "127.0.0.8",
			Port:         8000,
		},
		ServiceNameList: []string{factory.UpfServiceNameEventExposure},
	}
	cfg.SetDefaults()
	upf_context.GetSelf().Init(cfg)
}

func validSubscription() *sbimodels.EventSubscription {
	return &sbimodels.EventSubscription{
		EventNotifyURI: "https://callback.example.com/notify",
		EventList: []sbimodels.Event{{
			Type: sbimodels.EventTypeQosMonitoring,
			QosMon: &openapimodels.QosMonitoringData{
				ReqQosMonParams: []openapimodels.RequestedQosMonitoringParameter{
					openapimodels.RequestedQosMonitoringParameter_DOWNLINK,
				},
			},
		}},
	}
}
