package factory

import (
	"runtime"
	"time"

	"github.com/davecgh/go-spew/spew"
	"github.com/acore2026/openapi/models"

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
	Forwarder string     `yaml:"forwarder" valid:"required,in(gtp5g|empty|userspace)"`
	IfList    []IfInfo   `yaml:"ifList"    valid:"optional"`
	Userspace *Userspace `yaml:"userspace" valid:"optional"`
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
