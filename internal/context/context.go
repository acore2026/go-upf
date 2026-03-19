package context

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	sbimodels "github.com/acore2026/go-upf/internal/sbi/models"
	"github.com/acore2026/go-upf/pkg/factory"
	"github.com/acore2026/openapi/models"
)

var self = &UPFContext{
	NfServices:    make(map[string]models.NrfNfManagementNfService),
	subscriptions: make(map[string]*sbimodels.SubscriptionRecord),
}

type UPFContext struct {
	sync.RWMutex

	NfID           string
	NrfURI         string
	NrfCertPem     string
	OAuth2Required bool
	Scheme         models.UriScheme
	RegisterIPv4   string
	BindingIPv4    string
	SBIPort        int
	RecoveryTime   time.Time

	NfServices    map[string]models.NrfNfManagementNfService
	subscriptions map[string]*sbimodels.SubscriptionRecord
	nextSubID     uint64
}

func GetSelf() *UPFContext {
	return self
}

func (c *UPFContext) Init(cfg *factory.Config) {
	c.Lock()
	defer c.Unlock()

	if cfg.NfInstanceID == "" {
		cfg.NfInstanceID = uuid.NewString()
	}

	c.NfID = cfg.NfInstanceID
	c.NrfURI = cfg.NrfURI
	c.NrfCertPem = cfg.NrfCertPem
	c.Scheme = cfg.GetSbiScheme()
	c.RecoveryTime = time.Now().UTC()
	c.NfServices = make(map[string]models.NrfNfManagementNfService)
	c.subscriptions = make(map[string]*sbimodels.SubscriptionRecord)
	c.nextSubID = 0

	if cfg.Sbi == nil {
		return
	}

	c.RegisterIPv4 = cfg.Sbi.RegisterIPv4
	c.BindingIPv4 = cfg.Sbi.BindingIPv4
	c.SBIPort = cfg.Sbi.Port

	for _, serviceName := range cfg.ServiceNameList {
		service := models.NrfNfManagementNfService{
			ServiceInstanceId: fmt.Sprintf("%s-%s", serviceName, c.NfID),
			ServiceName:       models.ServiceName(serviceName),
			Versions: []models.NfServiceVersion{{
				ApiVersionInUri: "v1",
				ApiFullVersion:  "1.0.0",
			}},
			Scheme:          c.Scheme,
			NfServiceStatus: models.NfServiceStatus_REGISTERED,
			IpEndPoints: []models.IpEndPoint{{
				Ipv4Address: c.RegisterIPv4,
				Transport:   models.NrfNfManagementTransportProtocol_TCP,
				Port:        int32(c.SBIPort),
			}},
			ApiPrefix: fmt.Sprintf("%s://%s:%d%s", c.Scheme, c.RegisterIPv4, c.SBIPort, factory.UpfEventExposureResURI),
			AllowedNfTypes: []models.NrfNfManagementNfType{
				models.NrfNfManagementNfType_NWDAF,
			},
		}
		c.NfServices[serviceName] = service
	}
}

func (c *UPFContext) BuildNFProfile() models.NrfNfManagementNfProfile {
	c.RLock()
	defer c.RUnlock()

	profile := models.NrfNfManagementNfProfile{
		NfInstanceId:  c.NfID,
		NfType:        models.NrfNfManagementNfType_UPF,
		NfStatus:      models.NrfNfManagementNfStatus_REGISTERED,
		Ipv4Addresses: []string{c.RegisterIPv4},
		UpfInfo: &models.UpfInfo{
			UeIpAddrInd: true,
		},
	}

	if len(c.NfServices) > 0 {
		services := make([]models.NrfNfManagementNfService, 0, len(c.NfServices))
		for _, service := range c.NfServices {
			services = append(services, service)
		}
		profile.NfServices = services
	}

	return profile
}

func (c *UPFContext) nextID() string {
	c.nextSubID++
	return fmt.Sprintf("%d", c.nextSubID)
}

func (c *UPFContext) SaveSubscription(subscription *sbimodels.EventSubscription) *sbimodels.SubscriptionRecord {
	c.Lock()
	defer c.Unlock()

	record := &sbimodels.SubscriptionRecord{
		ID:           c.nextID(),
		CreatedAt:    time.Now().UTC(),
		Subscription: subscription,
	}
	c.subscriptions[record.ID] = record
	return record
}

func (c *UPFContext) FindSubscription(id string) (*sbimodels.SubscriptionRecord, bool) {
	c.Lock()
	defer c.Unlock()

	record, ok := c.subscriptions[id]
	if !ok {
		return nil, false
	}

	if isExpired(record.Subscription) {
		delete(c.subscriptions, id)
		return nil, false
	}
	return record, true
}

func (c *UPFContext) UpdateSubscription(id string, subscription *sbimodels.EventSubscription) (*sbimodels.SubscriptionRecord, bool) {
	c.Lock()
	defer c.Unlock()

	record, ok := c.subscriptions[id]
	if !ok {
		return nil, false
	}
	record.Subscription = subscription
	return record, true
}

func (c *UPFContext) DeleteSubscription(id string) bool {
	c.Lock()
	defer c.Unlock()

	if _, ok := c.subscriptions[id]; !ok {
		return false
	}
	delete(c.subscriptions, id)
	return true
}

func isExpired(subscription *sbimodels.EventSubscription) bool {
	if subscription == nil || subscription.Options == nil || subscription.Options.Expiry == nil {
		return false
	}
	return time.Now().UTC().After(subscription.Options.Expiry.UTC())
}
