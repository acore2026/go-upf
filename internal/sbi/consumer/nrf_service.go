package consumer

import (
	"context"
	"strings"

	upf_context "github.com/free5gc/go-upf/internal/context"
	"github.com/free5gc/go-upf/internal/logger"
	"github.com/free5gc/openapi/models"
	"github.com/free5gc/openapi/nrf/NFManagement"
)

type NrfService struct{}

func (s *NrfService) RegisterNFInstance(ctx context.Context) error {
	self := upf_context.GetSelf()
	if self.NrfURI == "" {
		return nil
	}

	profile := self.BuildNFProfile()
	configuration := NFManagement.NewConfiguration()
	configuration.SetBasePath(self.NrfURI)
	client := NFManagement.NewAPIClient(configuration)

	req := &NFManagement.RegisterNFInstanceRequest{
		NfInstanceID:             &profile.NfInstanceId,
		NrfNfManagementNfProfile: &profile,
	}
	rsp, err := client.NFInstanceIDDocumentApi.RegisterNFInstance(ctx, req)
	if err != nil {
		return err
	}

	if rsp != nil && rsp.NrfNfManagementNfProfile.CustomInfo != nil {
		if oauth2, ok := rsp.NrfNfManagementNfProfile.CustomInfo["oauth2"].(bool); ok {
			self.OAuth2Required = oauth2
		}
	}
	if rsp != nil && rsp.Location != "" {
		if resourceURI, _, ok := strings.Cut(rsp.Location, "/nnrf-nfm/"); ok {
			self.NrfURI = resourceURI
		}
	}
	logger.SBILog.Infof("registered UPF in NRF at %s", self.NrfURI)
	return nil
}

func (s *NrfService) DeregisterNFInstance(ctx context.Context) error {
	self := upf_context.GetSelf()
	if self.NrfURI == "" || self.NfID == "" {
		return nil
	}

	configuration := NFManagement.NewConfiguration()
	configuration.SetBasePath(self.NrfURI)
	client := NFManagement.NewAPIClient(configuration)

	req := &NFManagement.DeregisterNFInstanceRequest{
		NfInstanceID: &self.NfID,
	}
	_, err := client.NFInstanceIDDocumentApi.DeregisterNFInstance(ctx, req)
	if err == nil {
		logger.SBILog.Infof("deregistered UPF instance %s from NRF", self.NfID)
	}
	return err
}

func ServiceName() models.ServiceName {
	return models.ServiceName(factoryServiceName())
}

func factoryServiceName() string {
	return "nupf-event-exposure"
}
