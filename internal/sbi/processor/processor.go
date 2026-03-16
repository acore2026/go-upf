package processor

import (
	"net/url"
	"slices"

	upf_context "github.com/free5gc/go-upf/internal/context"
	sbimodels "github.com/free5gc/go-upf/internal/sbi/models"
	openapimodels "github.com/free5gc/openapi/models"
)

type Processor struct{}

func New() *Processor {
	return &Processor{}
}

func (p *Processor) CreateSubscription(req sbimodels.CreateEventSubscription) (*sbimodels.CreatedEventSubscription, *openapimodels.ProblemDetails) {
	if req.Subscription == nil {
		return nil, badRequest("SUBSCRIPTION_EMPTY", "subscription is required")
	}
	if problem := validateSubscription(req.Subscription); problem != nil {
		return nil, problem
	}

	record := upf_context.GetSelf().SaveSubscription(req.Subscription)
	return &sbimodels.CreatedEventSubscription{
		SubscriptionID: record.ID,
		Subscription:   record.Subscription,
	}, nil
}

func (p *Processor) GetSubscription(id string) (*sbimodels.SubscriptionRecord, *openapimodels.ProblemDetails) {
	record, ok := upf_context.GetSelf().FindSubscription(id)
	if !ok {
		return nil, notFound("SUBSCRIPTION_NOT_FOUND", "subscription not found")
	}
	return record, nil
}

func (p *Processor) ModifySubscription(id string, req sbimodels.ModifySubscriptionRequest) (*sbimodels.UpdatedEventSubscription, *openapimodels.ProblemDetails) {
	if req.Subscription == nil {
		return nil, badRequest("SUBSCRIPTION_EMPTY", "subscription is required")
	}
	if problem := validateSubscription(req.Subscription); problem != nil {
		return nil, problem
	}

	record, ok := upf_context.GetSelf().UpdateSubscription(id, req.Subscription)
	if !ok {
		return nil, notFound("SUBSCRIPTION_NOT_FOUND", "subscription not found")
	}

	return &sbimodels.UpdatedEventSubscription{
		SubscriptionID: record.ID,
		Subscription:   record.Subscription,
	}, nil
}

func (p *Processor) DeleteSubscription(id string) *openapimodels.ProblemDetails {
	if ok := upf_context.GetSelf().DeleteSubscription(id); !ok {
		return notFound("SUBSCRIPTION_NOT_FOUND", "subscription not found")
	}
	return nil
}

func validateSubscription(subscription *sbimodels.EventSubscription) *openapimodels.ProblemDetails {
	if len(subscription.EventList) == 0 {
		return badRequest("EVENT_LIST_EMPTY", "eventList is required")
	}
	if _, err := url.ParseRequestURI(subscription.EventNotifyURI); err != nil {
		return badRequest("INVALID_NOTIFY_URI", "eventNotifyUri must be a valid absolute URI")
	}

	for _, event := range subscription.EventList {
		if event.Type != sbimodels.EventTypeQosMonitoring {
			return unsupported("EVENT_NOT_SUPPORTED", "only QOS_MONITORING is supported")
		}
		if event.QosMon == nil {
			return badRequest("QOS_MONITORING_DATA_MISSING", "qosMon is required for QOS_MONITORING")
		}
		if len(event.QosMon.ReqQosMonParams) == 0 {
			return badRequest("QOS_MONITORING_PARAMS_MISSING", "reqQosMonParams must not be empty")
		}
		for _, param := range event.QosMon.ReqQosMonParams {
			if !slices.Contains([]openapimodels.RequestedQosMonitoringParameter{}, param) {
				return unsupported("QOS_MONITORING_PARAM_NOT_SUPPORTED", "requested QoS monitoring parameters are not supported by the current UPF datapath")
			}
		}
	}

	return nil
}

func badRequest(cause string, detail string) *openapimodels.ProblemDetails {
	return &openapimodels.ProblemDetails{
		Status: 400,
		Cause:  cause,
		Detail: detail,
		Title:  "Malformed request",
	}
}

func unsupported(cause string, detail string) *openapimodels.ProblemDetails {
	return &openapimodels.ProblemDetails{
		Status: 501,
		Cause:  cause,
		Detail: detail,
		Title:  "Feature not supported",
	}
}

func notFound(cause string, detail string) *openapimodels.ProblemDetails {
	return &openapimodels.ProblemDetails{
		Status: 404,
		Cause:  cause,
		Detail: detail,
		Title:  "Not found",
	}
}
