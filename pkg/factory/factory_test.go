package factory

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const validConfigYAML = `version: 1.0.3
description: unit test config
pfcp:
  addr: 127.0.0.8
  nodeID: 127.0.0.8
  retransTimeout: 1s
  maxRetrans: 3
gtpu:
  forwarder: gtp5g
  ifList:
    - addr: 127.0.0.8
      type: N3
dnnList:
  - dnn: internet
    cidr: 10.60.0.0/16
logger:
  enable: true
  level: info
  reportCaller: false
`

func TestReadConfig(t *testing.T) {
	t.Run("reads valid config", func(t *testing.T) {
		cfgPath := writeConfigFile(t, t.TempDir(), validConfigYAML)

		cfg, err := ReadConfig(cfgPath)

		require.NoError(t, err)
		require.NotNil(t, cfg)
		assert.Equal(t, "1.0.3", cfg.GetVersion())
		assert.Equal(t, "127.0.0.8", cfg.Pfcp.NodeID)
		assert.Equal(t, "gtp5g", cfg.Gtpu.Forwarder)
		assert.Len(t, cfg.DnnList, 1)
	})

	t.Run("applies userspace defaults", func(t *testing.T) {
		cfgPath := writeConfigFile(t, t.TempDir(), `version: 1.0.3
description: userspace config
pfcp:
  addr: 127.0.0.8
  nodeID: 127.0.0.8
  retransTimeout: 1s
gtpu:
  forwarder: userspace
dnnList:
  - dnn: internet
    cidr: 10.60.0.0/16
logger:
  enable: true
  level: info
  reportCaller: false
`)

		cfg, err := ReadConfig(cfgPath)

		require.NoError(t, err)
		require.NotNil(t, cfg)
		require.NotNil(t, cfg.Gtpu.Userspace)
		assert.GreaterOrEqual(t, cfg.Gtpu.Userspace.Workers, 1)
		assert.Equal(t, 1024, cfg.Gtpu.Userspace.QueueSize)
		assert.Equal(t, "upfusr0", cfg.Gtpu.Userspace.TunName)
	})

	t.Run("rejects unresolvable node id", func(t *testing.T) {
		cfgPath := writeConfigFile(t, t.TempDir(), `version: 1.0.3
description: invalid node id
pfcp:
  addr: 127.0.0.8
  nodeID: invalid.invalid.invalid
  retransTimeout: 1s
  maxRetrans: 3
gtpu:
  forwarder: gtp5g
  ifList:
    - addr: 127.0.0.8
      type: N3
dnnList:
  - dnn: internet
    cidr: 10.60.0.0/16
logger:
  enable: true
  level: info
  reportCaller: false
`)

		cfg, err := ReadConfig(cfgPath)

		require.Error(t, err)
		assert.Nil(t, cfg)
		assert.Contains(t, err.Error(), "can't be resolved")
	})

	t.Run("reads userspace forwarder config", func(t *testing.T) {
		cfgPath := writeConfigFile(t, t.TempDir(), `version: 1.0.3
description: userspace config
pfcp:
  addr: 127.0.0.8
  nodeID: 127.0.0.8
  retransTimeout: 1s
  maxRetrans: 3
gtpu:
  forwarder: userspace
  userspace:
    workers: 4
    queueSize: 256
    tunName: upfue0
    tunMtu: 1400
dnnList:
  - dnn: internet
    cidr: 10.60.0.0/16
logger:
  enable: true
  level: info
  reportCaller: false
`)

		cfg, err := ReadConfig(cfgPath)

		require.NoError(t, err)
		require.NotNil(t, cfg)
		assert.Equal(t, "userspace", cfg.Gtpu.Forwarder)
		require.NotNil(t, cfg.Gtpu.Userspace)
		assert.Equal(t, 4, cfg.Gtpu.Userspace.Workers)
		assert.Equal(t, 256, cfg.Gtpu.Userspace.QueueSize)
		assert.Equal(t, "upfue0", cfg.Gtpu.Userspace.TunName)
		assert.EqualValues(t, 1400, cfg.Gtpu.Userspace.TunMTU)
	})
}

func TestInitConfigFactoryUsesDefaultPath(t *testing.T) {
	wd, err := os.Getwd()
	require.NoError(t, err)

	tmpDir := t.TempDir()
	configDir := filepath.Join(tmpDir, "config")
	require.NoError(t, os.Mkdir(configDir, 0o755))
	writeConfigFile(t, configDir, validConfigYAML)

	require.NoError(t, os.Chdir(tmpDir))
	defer func() {
		require.NoError(t, os.Chdir(wd))
	}()

	cfg := &Config{}

	err = InitConfigFactory("", cfg)

	require.NoError(t, err)
	assert.Equal(t, "1.0.3", cfg.Version)
	assert.Equal(t, "127.0.0.8", cfg.Pfcp.Addr)
}

func writeConfigFile(t *testing.T, dir string, content string) string {
	t.Helper()

	path := filepath.Join(dir, "upfcfg.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	return path
}
