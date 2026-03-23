package factory

import (
	"runtime"
	"time"

	"github.com/acore2026/openapi/models"
	"github.com/davecgh/go-spew/spew"

	"github.com/acore2026/go-upf/internal/logger"
)

const (
	UpfDefaultConfigPath               = "./config/upfcfg.yaml"
	UpfDefaultIPv4                     = "127.0.0.8"
	UpfPfcpDefaultPort                 = 8805
	UpfGtpDefaultPort                  = 2152
	UpfDefaultNrfURI                   = "https://127.0.0.10:8000"
	UpfSbiDefaultPort                  = 8000
	UpfSbiDefaultScheme                = "https"
	UpfDefaultCertPemPath              = "./cert/upf.pem"
	UpfDefaultPrivateKeyPath           = "./cert/upf.key"
	UpfEventExposureResURI             = "/nupf-event-exposure/v1"
	UpfServiceNameEventExposure string = "nupf-event-exposure"
)

type Config struct {
	Version         string    `yaml:"version"         valid:"required,in(1.0.3)"`
	Description     string    `yaml:"description"     valid:"optional"`
	NfInstanceID    string    `yaml:"nfInstanceId"    valid:"optional"`
	NrfURI          string    `yaml:"nrfUri"          valid:"optional,url"`
	NrfCertPem      string    `yaml:"nrfCertPem"      valid:"optional"`
	ServiceNameList []string  `yaml:"serviceNameList" valid:"optional"`
	Pfcp            *Pfcp     `yaml:"pfcp"            valid:"required"`
	Sbi             *Sbi      `yaml:"sbi"             valid:"optional"`
	Gtpu            *Gtpu     `yaml:"gtpu"            valid:"required"`
	DnnList         []DnnList `yaml:"dnnList"         valid:"required"`
	Logger          *Logger   `yaml:"logger"          valid:"required"`
}

type Pfcp struct {
	Addr           string        `yaml:"addr"           valid:"required,host"`
	NodeID         string        `yaml:"nodeID"         valid:"required,host"`
	RetransTimeout time.Duration `yaml:"retransTimeout" valid:"required"`
	MaxRetrans     uint8         `yaml:"maxRetrans"     valid:"optional"`
}

type Gtpu struct {
	Forwarder   string       `yaml:"forwarder"   valid:"required,in(gtp5g|empty|userspace)"`
	IfList      []IfInfo     `yaml:"ifList"      valid:"optional"`
	Userspace   *Userspace   `yaml:"userspace"   valid:"optional"`
	AdaptiveQoS *AdaptiveQoS `yaml:"adaptiveQos" valid:"optional"`
}

type IfInfo struct {
	Addr   string `yaml:"addr"   valid:"required,host"`
	Type   string `yaml:"type"   valid:"required,in(N3|N9)"`
	Name   string `yaml:"name"   valid:"optional"`
	IfName string `yaml:"ifname" valid:"optional"`
	MTU    uint32 `yaml:"mtu"    valid:"optional"`
}

type DnnList struct {
	Dnn       string `yaml:"dnn"       valid:"required"`
	Cidr      string `yaml:"cidr"      valid:"required,cidr"`
	NatIfName string `yaml:"natifname" valid:"optional"`
}

type Userspace struct {
	Workers   int    `yaml:"workers"   valid:"optional"`
	QueueSize int    `yaml:"queueSize" valid:"optional"`
	TunName   string `yaml:"tunName"   valid:"optional"`
	TunMTU    uint32 `yaml:"tunMtu"    valid:"optional"`
}

type AdaptiveQoS struct {
	Enable            bool                      `yaml:"enable"            valid:"optional"`
	MASQUEBindAddress string                    `yaml:"masqueBindAddress" valid:"optional,host"`
	MASQUEPort        int                       `yaml:"masquePort"        valid:"optional,port"`
	ReportBindAddress string                    `yaml:"reportBindAddress" valid:"optional,host"`
	ReportPort        int                       `yaml:"reportPort"        valid:"optional,port"`
	DebugBindAddress  string                    `yaml:"debugBindAddress"  valid:"optional,host"`
	DebugPort         int                       `yaml:"debugPort"         valid:"optional,port"`
	TLS               *Tls                      `yaml:"tls"               valid:"optional"`
	GNBControl        *AdaptiveQoSGNBControl    `yaml:"gnbControl"        valid:"optional"`
	Authorization     *AdaptiveQoSAuthorization `yaml:"authorization"     valid:"optional"`
	Rules             []AdaptiveQoSRule         `yaml:"rules"             valid:"optional"`
}

type AdaptiveQoSGNBControl struct {
	Addr string `yaml:"addr" valid:"optional,host"`
	Port int    `yaml:"port" valid:"optional,port"`
}

type AdaptiveQoSAuthorization struct {
	DefaultProfileDuration time.Duration `yaml:"defaultProfileDuration" valid:"optional"`
	MaxBitrateUL           uint64        `yaml:"maxBitrateUl"           valid:"optional"`
	MaxBitrateDL           uint64        `yaml:"maxBitrateDl"           valid:"optional"`
	MaxGFBRUL              uint64        `yaml:"maxGfbrUl"              valid:"optional"`
	MaxGFBRDL              uint64        `yaml:"maxGfbrDl"              valid:"optional"`
}

type AdaptiveQoSRule struct {
	Name                   string        `yaml:"name"                      valid:"optional"`
	TrafficPattern         string        `yaml:"trafficPattern"            valid:"optional"`
	LatencySensitivity     string        `yaml:"latencySensitivity"        valid:"optional"`
	PacketLossTolerance    string        `yaml:"packetLossTolerance"       valid:"optional"`
	BitrateChangeDirection string        `yaml:"bitrateChangeDirection"    valid:"optional"`
	Target5QI              uint8         `yaml:"target5qi"                 valid:"optional"`
	TargetARP              uint8         `yaml:"targetArp"                 valid:"optional"`
	TargetGFBRUL           uint64        `yaml:"targetGfbrUl"              valid:"optional"`
	TargetGFBRDL           uint64        `yaml:"targetGfbrDl"              valid:"optional"`
	TargetMFBRUL           uint64        `yaml:"targetMfbrUl"              valid:"optional"`
	TargetMFBRDL           uint64        `yaml:"targetMfbrDl"              valid:"optional"`
	TargetPacketLossRateUL uint32        `yaml:"targetPacketLossRateUl"    valid:"optional"`
	TargetPacketLossRateDL uint32        `yaml:"targetPacketLossRateDl"    valid:"optional"`
	OverrideGateUL         *bool         `yaml:"overrideGateUl"            valid:"optional"`
	OverrideGateDL         *bool         `yaml:"overrideGateDl"            valid:"optional"`
	OverrideMBRUL          uint64        `yaml:"overrideMbrUl"             valid:"optional"`
	OverrideMBRDL          uint64        `yaml:"overrideMbrDl"             valid:"optional"`
	Duration               time.Duration `yaml:"duration"                  valid:"optional"`
}

type Logger struct {
	Enable       bool   `yaml:"enable"       valid:"optional"`
	Level        string `yaml:"level"        valid:"required,in(trace|debug|info|warn|error|fatal|panic)"`
	ReportCaller bool   `yaml:"reportCaller" valid:"optional"`
}

type Sbi struct {
	Scheme       string `yaml:"scheme"       valid:"optional,scheme"`
	RegisterIPv4 string `yaml:"registerIPv4" valid:"optional,host"`
	BindingIPv4  string `yaml:"bindingIPv4"  valid:"optional,host"`
	Port         int    `yaml:"port"         valid:"optional,port"`
	Tls          *Tls   `yaml:"tls"          valid:"optional"`
}

type Tls struct {
	Pem string `yaml:"pem" valid:"optional"`
	Key string `yaml:"key" valid:"optional"`
}

func (c *Config) SetDefaults() {
	if c.Gtpu != nil && c.Gtpu.Forwarder == "userspace" {
		if c.Gtpu.Userspace == nil {
			c.Gtpu.Userspace = &Userspace{}
		}
		if c.Gtpu.Userspace.Workers <= 0 {
			c.Gtpu.Userspace.Workers = runtime.GOMAXPROCS(0)
			if c.Gtpu.Userspace.Workers <= 0 {
				c.Gtpu.Userspace.Workers = 1
			}
		}
		if c.Gtpu.Userspace.QueueSize <= 0 {
			c.Gtpu.Userspace.QueueSize = 1024
		}
		if c.Gtpu.Userspace.TunName == "" {
			c.Gtpu.Userspace.TunName = "upfusr0"
		}
		if c.Gtpu.AdaptiveQoS != nil && c.Gtpu.AdaptiveQoS.Enable {
			if c.Gtpu.AdaptiveQoS.MASQUEBindAddress == "" {
				c.Gtpu.AdaptiveQoS.MASQUEBindAddress = UpfDefaultIPv4
			}
			if c.Gtpu.AdaptiveQoS.MASQUEPort == 0 {
				c.Gtpu.AdaptiveQoS.MASQUEPort = 4433
			}
			if c.Gtpu.AdaptiveQoS.ReportBindAddress == "" {
				c.Gtpu.AdaptiveQoS.ReportBindAddress = "127.0.0.1"
			}
			if c.Gtpu.AdaptiveQoS.ReportPort == 0 {
				c.Gtpu.AdaptiveQoS.ReportPort = 7777
			}
			if c.Gtpu.AdaptiveQoS.DebugBindAddress == "" {
				c.Gtpu.AdaptiveQoS.DebugBindAddress = "127.0.0.1"
			}
			if c.Gtpu.AdaptiveQoS.DebugPort == 0 {
				c.Gtpu.AdaptiveQoS.DebugPort = 9082
			}
			if c.Gtpu.AdaptiveQoS.Authorization == nil {
				c.Gtpu.AdaptiveQoS.Authorization = &AdaptiveQoSAuthorization{}
			}
			if c.Gtpu.AdaptiveQoS.Authorization.DefaultProfileDuration <= 0 {
				c.Gtpu.AdaptiveQoS.Authorization.DefaultProfileDuration = 30 * time.Second
			}
			if c.Gtpu.AdaptiveQoS.GNBControl != nil && c.Gtpu.AdaptiveQoS.GNBControl.Port == 0 {
				c.Gtpu.AdaptiveQoS.GNBControl.Port = UpfGtpDefaultPort
			}
		}
	}

	if c.NrfURI == "" {
		c.NrfURI = UpfDefaultNrfURI
	}

	if c.Sbi != nil {
		if c.Sbi.Scheme == "" {
			c.Sbi.Scheme = UpfSbiDefaultScheme
		}
		if c.Sbi.RegisterIPv4 == "" {
			c.Sbi.RegisterIPv4 = UpfDefaultIPv4
		}
		if c.Sbi.BindingIPv4 == "" {
			c.Sbi.BindingIPv4 = c.Sbi.RegisterIPv4
		}
		if c.Sbi.Port == 0 {
			c.Sbi.Port = UpfSbiDefaultPort
		}
		if len(c.ServiceNameList) == 0 {
			c.ServiceNameList = []string{UpfServiceNameEventExposure}
		}
	}
}

func (c *Config) GetSbiScheme() models.UriScheme {
	if c.Sbi == nil {
		return models.UriScheme_HTTP
	}
	return models.UriScheme(c.Sbi.Scheme)
}

func (c *Config) GetCertPemPath() string {
	if c.Sbi == nil || c.Sbi.Tls == nil || c.Sbi.Tls.Pem == "" {
		return UpfDefaultCertPemPath
	}
	return c.Sbi.Tls.Pem
}

func (c *Config) GetCertKeyPath() string {
	if c.Sbi == nil || c.Sbi.Tls == nil || c.Sbi.Tls.Key == "" {
		return UpfDefaultPrivateKeyPath
	}
	return c.Sbi.Tls.Key
}

func (c *Config) GetAdaptiveQoSCertPemPath() string {
	if c == nil {
		return UpfDefaultCertPemPath
	}
	if c.Gtpu == nil || c.Gtpu.AdaptiveQoS == nil || c.Gtpu.AdaptiveQoS.TLS == nil || c.Gtpu.AdaptiveQoS.TLS.Pem == "" {
		return c.GetCertPemPath()
	}
	return c.Gtpu.AdaptiveQoS.TLS.Pem
}

func (c *Config) GetAdaptiveQoSCertKeyPath() string {
	if c == nil {
		return UpfDefaultPrivateKeyPath
	}
	if c.Gtpu == nil || c.Gtpu.AdaptiveQoS == nil || c.Gtpu.AdaptiveQoS.TLS == nil || c.Gtpu.AdaptiveQoS.TLS.Key == "" {
		return c.GetCertKeyPath()
	}
	return c.Gtpu.AdaptiveQoS.TLS.Key
}

func (c *Config) GetVersion() string {
	return c.Version
}

func (c *Config) Print() {
	spew.Config.Indent = "\t"
	str := spew.Sdump(c)
	logger.CfgLog.Infof("==================================================")
	logger.CfgLog.Infof("%s", str)
	logger.CfgLog.Infof("==================================================")
}
