package userspace

import (
	"net"
	"time"

	"github.com/pkg/errors"
	"github.com/wmnsk/go-pfcp/ie"

	"github.com/acore2026/go-upf/internal/report"
	util_pfcp "github.com/acore2026/util/pfcp"
)

var (
	ErrSessionNotFound = errors.New("userspace: session not found")
	ErrPDRNotFound     = errors.New("userspace: pdr not found")
	ErrFARNotFound     = errors.New("userspace: far not found")
	ErrQERNotFound     = errors.New("userspace: qer not found")
	ErrURRNotFound     = errors.New("userspace: urr not found")
	ErrBARNotFound     = errors.New("userspace: bar not found")
)

func parsePDR(req *ie.IE) (*PDRRule, error) {
	ies, err := req.CreatePDR()
	if err != nil {
		return nil, err
	}
	return decodePDR(ies, req.Payload)
}

func parseUpdatePDR(req *ie.IE) (*PDRRule, error) {
	ies, err := req.UpdatePDR()
	if err != nil {
		return nil, err
	}
	return decodePDR(ies, req.Payload)
}

func decodePDR(ies []*ie.IE, raw []byte) (*PDRRule, error) {
	rule := &PDRRule{Raw: append([]byte(nil), raw...)}
	for _, x := range ies {
		switch x.Type {
		case ie.PDRID:
			v, err := x.PDRID()
			if err != nil {
				return nil, err
			}
			rule.ID = v
		case ie.Precedence:
			v, err := x.Precedence()
			if err != nil {
				return nil, err
			}
			rule.Precedence = &v
		case ie.PDI:
			pdi, err := decodePDI(x)
			if err != nil {
				return nil, err
			}
			rule.PDI = pdi
		case ie.OuterHeaderRemoval:
			v, err := x.OuterHeaderRemovalDescription()
			if err != nil {
				return nil, err
			}
			rule.OuterHeaderRemoval = &v
		case ie.FARID:
			v, err := x.FARID()
			if err != nil {
				return nil, err
			}
			rule.FARID = &v
		case ie.QERID:
			v, err := x.QERID()
			if err != nil {
				return nil, err
			}
			rule.QERIDs = append(rule.QERIDs, v)
		case ie.URRID:
			v, err := x.URRID()
			if err != nil {
				return nil, err
			}
			rule.URRIDs = append(rule.URRIDs, v)
		}
	}
	if rule.ID == 0 {
		return nil, errors.New("userspace: missing PDRID")
	}
	return rule, nil
}

func decodePDI(i *ie.IE) (*PDI, error) {
	ies, err := i.PDI()
	if err != nil {
		return nil, err
	}
	pdi := &PDI{}
	for _, x := range ies {
		switch x.Type {
		case ie.SourceInterface:
			v, err := x.SourceInterface()
			if err != nil {
				return nil, err
			}
			pdi.SourceInterface = &v
		case ie.FTEID:
			v, err := x.FTEID()
			if err != nil {
				return nil, err
			}
			pdi.FTEID = &FTEID{TEID: v.TEID, IPv4: append(net.IP(nil), v.IPv4Address...)}
		case ie.NetworkInstance:
			v, err := x.NetworkInstance()
			if err != nil {
				return nil, err
			}
			pdi.NetworkInstance = v
		case ie.UEIPAddress:
			v, err := x.UEIPAddress()
			if err != nil {
				return nil, err
			}
			if len(v.IPv4Address) > 0 {
				pdi.UEIPv4 = append(net.IP(nil), v.IPv4Address...)
			}
		case ie.SDFFilter:
			v, err := x.SDFFilter()
			if err != nil {
				return nil, err
			}
			if v.HasFD() {
				pdi.SDFFilters = append(pdi.SDFFilters, v.FlowDescription)
				rule, err := parseFlowDescription(v.FlowDescription)
				if err != nil {
					return nil, err
				}
				pdi.SDFRules = append(pdi.SDFRules, rule)
			}
		case ie.ApplicationID:
			v, err := x.ApplicationID()
			if err != nil {
				return nil, err
			}
			pdi.ApplicationID = v
		}
	}
	return pdi, nil
}

func parseFAR(req *ie.IE) (*FARRule, error) {
	ies, err := req.CreateFAR()
	if err != nil {
		return nil, err
	}
	return decodeFAR(ies, req.Payload)
}

func parseUpdateFAR(req *ie.IE) (*FARRule, error) {
	ies, err := req.UpdateFAR()
	if err != nil {
		return nil, err
	}
	return decodeFAR(ies, req.Payload)
}

func decodeFAR(ies []*ie.IE, raw []byte) (*FARRule, error) {
	rule := &FARRule{Raw: append([]byte(nil), raw...)}
	for _, x := range ies {
		switch x.Type {
		case ie.FARID:
			v, err := x.FARID()
			if err != nil {
				return nil, err
			}
			rule.ID = v
		case ie.ApplyAction:
			v, err := x.ApplyAction()
			if err != nil {
				return nil, err
			}
			if err := rule.ApplyAction.Unmarshal(v); err != nil {
				return nil, err
			}
		case ie.ForwardingParameters, ie.UpdateForwardingParameters:
			var fpIEs []*ie.IE
			var err error
			if x.Type == ie.ForwardingParameters {
				fpIEs, err = x.ForwardingParameters()
			} else {
				fpIEs, err = x.UpdateForwardingParameters()
			}
			if err != nil {
				return nil, err
			}
			fp, err := decodeForwardingParameters(fpIEs)
			if err != nil {
				return nil, err
			}
			rule.Forwarding = fp
		case ie.BARID:
			v, err := x.BARID()
			if err != nil {
				return nil, err
			}
			rule.BARID = &v
		}
	}
	if rule.ID == 0 {
		return nil, errors.New("userspace: missing FARID")
	}
	return rule, nil
}

func decodeForwardingParameters(ies []*ie.IE) (*ForwardingParameters, error) {
	fp := &ForwardingParameters{}
	for _, x := range ies {
		switch x.Type {
		case ie.DestinationInterface:
			v, err := x.DestinationInterface()
			if err != nil {
				return nil, err
			}
			fp.DestinationInterface = &v
		case ie.NetworkInstance:
			v, err := x.NetworkInstance()
			if err != nil {
				return nil, err
			}
			fp.NetworkInstance = v
		case ie.OuterHeaderCreation:
			v, err := util_pfcp.ParseOuterHeaderCreation(x.Payload)
			if err != nil {
				return nil, err
			}
			fp.OuterHeaderCreation = &OuterHeaderCreation{
				Description: v.OuterHeaderCreationDescription,
				TEID:        v.TEID,
				IPv4:        append(net.IP(nil), v.IPv4Address...),
				Port:        v.PortNumber,
			}
		case ie.ForwardingPolicy:
			v, err := x.ForwardingPolicyIdentifier()
			if err != nil {
				return nil, err
			}
			fp.ForwardingPolicy = v
		case ie.PFCPSMReqFlags:
			v, err := x.PFCPSMReqFlags()
			if err != nil {
				return nil, err
			}
			fp.PFCPSMReqFlags = &v
		}
	}
	return fp, nil
}

func parseQER(req *ie.IE) (*QERRule, error) {
	ies, err := req.CreateQER()
	if err != nil {
		return nil, err
	}
	return decodeQER(ies, req.Payload)
}

func parseUpdateQER(req *ie.IE) (*QERRule, error) {
	ies, err := req.UpdateQER()
	if err != nil {
		return nil, err
	}
	return decodeQER(ies, req.Payload)
}

func decodeQER(ies []*ie.IE, raw []byte) (*QERRule, error) {
	rule := &QERRule{Raw: append([]byte(nil), raw...)}
	for _, x := range ies {
		switch x.Type {
		case ie.QERID:
			v, err := x.QERID()
			if err != nil {
				return nil, err
			}
			rule.ID = v
		case ie.QERCorrelationID:
			v, err := x.QERCorrelationID()
			if err != nil {
				return nil, err
			}
			rule.CorrelationID = &v
		case ie.GateStatus:
			v, err := x.GateStatus()
			if err != nil {
				return nil, err
			}
			rule.GateStatus = &v
		case ie.MBR:
			ul, err := x.MBRUL()
			if err != nil {
				return nil, err
			}
			dl, err := x.MBRDL()
			if err != nil {
				return nil, err
			}
			rule.MBRUL = &ul
			rule.MBRDL = &dl
		case ie.GBR:
			ul, err := x.GBRUL()
			if err != nil {
				return nil, err
			}
			dl, err := x.GBRDL()
			if err != nil {
				return nil, err
			}
			rule.GBRUL = &ul
			rule.GBRDL = &dl
		case ie.QFI:
			v, err := x.QFI()
			if err != nil {
				return nil, err
			}
			rule.QFI = &v
		case ie.RQI:
			v, err := x.RQI()
			if err != nil {
				return nil, err
			}
			rule.RQI = &v
		case ie.PagingPolicyIndicator:
			v, err := x.PagingPolicyIndicator()
			if err != nil {
				return nil, err
			}
			rule.PPI = &v
		}
	}
	if rule.ID == 0 {
		return nil, errors.New("userspace: missing QERID")
	}
	return rule, nil
}

func parseURR(req *ie.IE) (*URRRule, error) {
	ies, err := req.CreateURR()
	if err != nil {
		return nil, err
	}
	return decodeURR(ies, req.Payload)
}

func parseUpdateURR(req *ie.IE) (*URRRule, error) {
	ies, err := req.UpdateURR()
	if err != nil {
		return nil, err
	}
	return decodeURR(ies, req.Payload)
}

func decodeURR(ies []*ie.IE, raw []byte) (*URRRule, error) {
	rule := &URRRule{Raw: append([]byte(nil), raw...)}
	for _, x := range ies {
		switch x.Type {
		case ie.URRID:
			v, err := x.URRID()
			if err != nil {
				return nil, err
			}
			rule.ID = v
		case ie.MeasurementMethod:
			v, err := x.MeasurementMethod()
			if err != nil {
				return nil, err
			}
			rule.MeasurementMethod = decodeMeasurementMethod(v)
		case ie.ReportingTriggers:
			v, err := x.ReportingTriggers()
			if err != nil {
				return nil, err
			}
			if err := rule.ReportingTrigger.Unmarshal(v); err != nil {
				return nil, err
			}
		case ie.MeasurementPeriod:
			v, err := x.MeasurementPeriod()
			if err != nil {
				return nil, err
			}
			rule.MeasurementPeriod = v
		case ie.MeasurementInformation:
			v, err := x.MeasurementInformation()
			if err != nil {
				return nil, err
			}
			rule.MeasurementInformation = decodeMeasurementInformation(v)
		case ie.VolumeThreshold:
			v, err := x.VolumeThreshold()
			if err != nil {
				return nil, err
			}
			rule.VolumeThreshold = &VolumeLimit{
				Flags:          v.Flags,
				TotalVolume:    v.TotalVolume,
				UplinkVolume:   v.UplinkVolume,
				DownlinkVolume: v.DownlinkVolume,
			}
		case ie.VolumeQuota:
			v, err := x.VolumeQuota()
			if err != nil {
				return nil, err
			}
			rule.VolumeQuota = &VolumeLimit{
				Flags:          v.Flags,
				TotalVolume:    v.TotalVolume,
				UplinkVolume:   v.UplinkVolume,
				DownlinkVolume: v.DownlinkVolume,
			}
		}
	}
	if rule.ID == 0 {
		return nil, errors.New("userspace: missing URRID")
	}
	return rule, nil
}

func parseBAR(req *ie.IE) (*BARRule, error) {
	ies, err := req.CreateBAR()
	if err != nil {
		return nil, err
	}
	return decodeBAR(ies, req.Payload)
}

func parseUpdateBAR(req *ie.IE) (*BARRule, error) {
	ies, err := req.UpdateBAR()
	if err != nil {
		return nil, err
	}
	return decodeBAR(ies, req.Payload)
}

func decodeBAR(ies []*ie.IE, raw []byte) (*BARRule, error) {
	rule := &BARRule{Raw: append([]byte(nil), raw...)}
	for _, x := range ies {
		switch x.Type {
		case ie.BARID:
			v, err := x.BARID()
			if err != nil {
				return nil, err
			}
			rule.ID = v
		case ie.DownlinkDataNotificationDelay:
			v, err := x.DownlinkDataNotificationDelay()
			if err != nil {
				return nil, err
			}
			delay := time.Duration(v)
			rule.DownlinkDataNotificationDelay = &delay
		case ie.SuggestedBufferingPacketsCount:
			v, err := x.SuggestedBufferingPacketsCount()
			if err != nil {
				return nil, err
			}
			count := uint16(v)
			rule.SuggestedBufferingPacketsCount = &count
		}
	}
	if rule.ID == 0 {
		return nil, errors.New("userspace: missing BARID")
	}
	return rule, nil
}

func decodeMeasurementMethod(v uint8) report.MeasureMethod {
	return report.MeasureMethod{
		DURAT: v&0x04 != 0,
		VOLUM: v&0x02 != 0,
		EVENT: v&0x01 != 0,
	}
}

func decodeMeasurementInformation(v uint8) report.MeasureInformation {
	return report.MeasureInformation{
		MBQE:  v&0x80 != 0,
		INAM:  v&0x40 != 0,
		RADI:  v&0x20 != 0,
		ISTM:  v&0x10 != 0,
		MNOP:  v&0x08 != 0,
		SSPOC: v&0x04 != 0,
		ASPOC: v&0x02 != 0,
		CIAM:  v&0x01 != 0,
	}
}
