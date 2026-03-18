package userspace

import (
	"fmt"
	"net"
	"strconv"
	"strings"
)

type packetMeta struct {
	SrcIP    net.IP
	DstIP    net.IP
	Protocol uint8
	SrcPort  uint16
	DstPort  uint16
	HasPorts bool
}

func parseFlowDescription(desc string) (*SDFFilterRule, error) {
	fields := strings.Fields(strings.TrimSpace(desc))
	if len(fields) < 7 {
		return nil, fmt.Errorf("userspace: unsupported SDF flow description %q", desc)
	}
	if !strings.EqualFold(fields[0], "permit") {
		return nil, fmt.Errorf("userspace: unsupported SDF action in %q", desc)
	}
	if !strings.EqualFold(fields[3], "from") {
		return nil, fmt.Errorf("userspace: malformed SDF flow description %q", desc)
	}

	toIdx := -1
	for i := 4; i < len(fields); i++ {
		if strings.EqualFold(fields[i], "to") {
			toIdx = i
			break
		}
	}
	if toIdx == -1 || toIdx+1 >= len(fields) {
		return nil, fmt.Errorf("userspace: malformed SDF flow description %q", desc)
	}

	src, err := parseFlowEndpoint(fields[4:toIdx])
	if err != nil {
		return nil, err
	}
	dst, err := parseFlowEndpoint(fields[toIdx+1:])
	if err != nil {
		return nil, err
	}

	return &SDFFilterRule{
		Action:      strings.ToLower(fields[0]),
		Direction:   strings.ToLower(fields[1]),
		Protocol:    strings.ToLower(fields[2]),
		Source:      src,
		Destination: dst,
	}, nil
}

func parseFlowEndpoint(tokens []string) (*FlowEndpoint, error) {
	ep := &FlowEndpoint{}
	if len(tokens) == 0 {
		return ep, nil
	}

	switch strings.ToLower(tokens[0]) {
	case "any":
		ep.Any = true
	case "assigned":
		ep.Assigned = true
	default:
		addr := tokens[0]
		if !strings.Contains(addr, "/") {
			addr += "/32"
		}
		_, network, err := net.ParseCIDR(addr)
		if err != nil {
			return nil, fmt.Errorf("userspace: unsupported SDF address %q", tokens[0])
		}
		ep.Network = network
	}

	if len(tokens) > 1 {
		ports, err := parsePortList(tokens[1:])
		if err != nil {
			return nil, err
		}
		ep.Ports = ports
	}
	return ep, nil
}

func parsePortList(tokens []string) ([]PortRange, error) {
	var ports []PortRange
	for _, token := range tokens {
		if strings.EqualFold(token, "any") {
			continue
		}
		for _, part := range strings.Split(token, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if strings.Contains(part, "-") {
				bounds := strings.SplitN(part, "-", 2)
				if len(bounds) != 2 {
					return nil, fmt.Errorf("userspace: invalid SDF port range %q", part)
				}
				from, err := strconv.ParseUint(bounds[0], 10, 16)
				if err != nil {
					return nil, fmt.Errorf("userspace: invalid SDF port %q", part)
				}
				to, err := strconv.ParseUint(bounds[1], 10, 16)
				if err != nil {
					return nil, fmt.Errorf("userspace: invalid SDF port %q", part)
				}
				ports = append(ports, PortRange{From: uint16(from), To: uint16(to)})
				continue
			}
			port, err := strconv.ParseUint(part, 10, 16)
			if err != nil {
				return nil, fmt.Errorf("userspace: invalid SDF port %q", part)
			}
			ports = append(ports, PortRange{From: uint16(port), To: uint16(port)})
		}
	}
	return ports, nil
}

func parseIPv4PacketMeta(payload []byte) (*packetMeta, error) {
	if len(payload) < 20 || payload[0]>>4 != 4 {
		return nil, fmt.Errorf("userspace: unsupported non-IPv4 packet")
	}
	ihl := int(payload[0]&0x0f) * 4
	if ihl < 20 || len(payload) < ihl {
		return nil, fmt.Errorf("userspace: invalid IPv4 header length")
	}
	meta := &packetMeta{
		SrcIP:    append(net.IP(nil), payload[12:16]...),
		DstIP:    append(net.IP(nil), payload[16:20]...),
		Protocol: payload[9],
	}
	switch meta.Protocol {
	case 6, 17:
		if len(payload) < ihl+4 {
			return nil, fmt.Errorf("userspace: truncated transport header")
		}
		meta.SrcPort = uint16(payload[ihl])<<8 | uint16(payload[ihl+1])
		meta.DstPort = uint16(payload[ihl+2])<<8 | uint16(payload[ihl+3])
		meta.HasPorts = true
	}
	return meta, nil
}

func matchSDF(binding *PDRBinding, meta *packetMeta, direction PacketDirection) bool {
	if binding == nil || binding.PDR == nil || binding.PDR.PDI == nil || len(binding.PDR.PDI.SDFRules) == 0 {
		return true
	}
	for _, rule := range binding.PDR.PDI.SDFRules {
		if rule == nil {
			continue
		}
		if ruleMatches(rule, binding.PDR.PDI.UEIPv4, meta, direction) {
			return true
		}
	}
	return false
}

func ruleMatches(rule *SDFFilterRule, ueIP net.IP, meta *packetMeta, direction PacketDirection) bool {
	if meta == nil {
		return false
	}
	switch rule.Direction {
	case "out":
		if direction != PacketDirectionUplink && !ruleUsesAssigned(rule) {
			return false
		}
	case "in":
		if direction != PacketDirectionDownlink && !ruleUsesAssigned(rule) {
			return false
		}
	}
	if !protocolMatches(rule.Protocol, meta.Protocol) {
		return false
	}
	if endpointsMatchRule(rule, ueIP, meta.SrcIP, meta.SrcPort, meta.DstIP, meta.DstPort, meta.HasPorts) {
		return true
	}

	// free5GC currently installs the same default SDF on both UL and DL PDRs.
	// For the default "permit out ip from any to assigned" rule, UL packets
	// should match even though the "assigned" UE IP appears as the source IP.
	if direction == PacketDirectionUplink && ruleUsesAssigned(rule) {
		return endpointsMatchRule(rule, ueIP, meta.DstIP, meta.DstPort, meta.SrcIP, meta.SrcPort, meta.HasPorts)
	}
	return false
}

func endpointsMatchRule(rule *SDFFilterRule, ueIP, srcIP net.IP, srcPort uint16, dstIP net.IP, dstPort uint16, hasPorts bool) bool {
	if !endpointMatches(rule.Source, ueIP, srcIP, srcPort, hasPorts) {
		return false
	}
	if !endpointMatches(rule.Destination, ueIP, dstIP, dstPort, hasPorts) {
		return false
	}
	return true
}

func ruleUsesAssigned(rule *SDFFilterRule) bool {
	if rule == nil {
		return false
	}
	return (rule.Source != nil && rule.Source.Assigned) || (rule.Destination != nil && rule.Destination.Assigned)
}

func protocolMatches(proto string, actual uint8) bool {
	switch strings.ToLower(proto) {
	case "", "ip":
		return true
	case "tcp":
		return actual == 6
	case "udp":
		return actual == 17
	case "icmp":
		return actual == 1
	default:
		value, err := strconv.ParseUint(proto, 10, 8)
		return err == nil && uint8(value) == actual
	}
}

func endpointMatches(endpoint *FlowEndpoint, ueIP, ip net.IP, port uint16, hasPorts bool) bool {
	if endpoint == nil {
		return true
	}
	if endpoint.Assigned {
		if len(ueIP) == 0 || !ueIP.Equal(ip) {
			return false
		}
	} else if endpoint.Network != nil && !endpoint.Network.Contains(ip) {
		return false
	}
	if len(endpoint.Ports) == 0 {
		return true
	}
	if !hasPorts {
		return false
	}
	for _, candidate := range endpoint.Ports {
		if port >= candidate.From && port <= candidate.To {
			return true
		}
	}
	return false
}
