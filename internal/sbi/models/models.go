package models

import (
	"time"

	openapimodels "github.com/free5gc/openapi/models"
)

type EventType string

const (
	EventTypeQosMonitoring EventType = "QOS_MONITORING"
)

type NotificationMethod string

const (
	NotificationMethodPeriodic         NotificationMethod = "PERIODIC"
	NotificationMethodOneTime          NotificationMethod = "ONE_TIME"
	NotificationMethodOnEventDetection NotificationMethod = "ON_EVENT_DETECTION"
)

type EventSubscriptionOptions struct {
	Trigger    NotificationMethod `json:"trigger,omitempty"`
	MaxReports int32              `json:"maxReports,omitempty"`
	Expiry     *time.Time         `json:"expiry,omitempty"`
}

type Event struct {
	Type          EventType                        `json:"type"`
	ImmediateFlag bool                             `json:"immediateFlag,omitempty"`
	QosMon        *openapimodels.QosMonitoringData `json:"qosMon,omitempty"`
}

type EventSubscription struct {
	EventList           []Event                   `json:"eventList"`
	EventNotifyURI      string                    `json:"eventNotifyUri"`
	NotifyCorrelationID string                    `json:"notifyCorrelationId,omitempty"`
	NfID                string                    `json:"nfId,omitempty"`
	Options             *EventSubscriptionOptions `json:"options,omitempty"`
}

type CreateEventSubscription struct {
	Subscription *EventSubscription `json:"subscription"`
}

type CreatedEventSubscription struct {
	SubscriptionID string               `json:"subscriptionId"`
	Subscription   *EventSubscription   `json:"subscription,omitempty"`
	ReportList     []QosMonitoringEvent `json:"reportList,omitempty"`
}

type ModifySubscriptionRequest struct {
	Subscription *EventSubscription `json:"subscription"`
}

type UpdatedEventSubscription struct {
	SubscriptionID string               `json:"subscriptionId"`
	Subscription   *EventSubscription   `json:"subscription,omitempty"`
	ReportList     []QosMonitoringEvent `json:"reportList,omitempty"`
}

type QosMonitoringEvent struct {
	Event               EventType                          `json:"event"`
	TimeStamp           time.Time                          `json:"timeStamp"`
	NotifyCorrelationID string                             `json:"notifyCorrelationId,omitempty"`
	QosMonitoringReport *openapimodels.QosMonitoringReport `json:"qosMonitoringReport,omitempty"`
}

type SubscriptionRecord struct {
	ID           string             `json:"subscriptionId"`
	CreatedAt    time.Time          `json:"createdAt"`
	Subscription *EventSubscription `json:"subscription"`
}
