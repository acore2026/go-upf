package pfcp

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wmnsk/go-pfcp/ie"
	"github.com/wmnsk/go-pfcp/message"
)

func TestValidatePfcpPacketLength(t *testing.T) {
	t.Run("accepts matching packet length", func(t *testing.T) {
		req := message.NewHeartbeatRequest(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)), nil)
		buf, err := req.Marshal()
		require.NoError(t, err)

		err = validatePfcpPacketLength(buf)

		assert.NoError(t, err)
	})

	t.Run("rejects too short packet", func(t *testing.T) {
		err := validatePfcpPacketLength([]byte{0x20, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "packet too short")
	})

	t.Run("rejects mismatched length", func(t *testing.T) {
		req := message.NewHeartbeatRequest(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)), nil)
		buf, err := req.Marshal()
		require.NoError(t, err)
		buf = buf[:len(buf)-1]

		err = validatePfcpPacketLength(buf)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "message length mismatch")
	})
}

func TestSetReqSeq(t *testing.T) {
	tests := []struct {
		name string
		msg  message.Message
	}{
		{
			name: "heartbeat request",
			msg:  message.NewHeartbeatRequest(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)), nil),
		},
		{
			name: "session report request",
			msg: message.NewSessionReportRequest(
				0,
				0,
				1,
				1,
				0,
				ie.NewReportType(0, 0, 1, 0),
			),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setReqSeq(tt.msg, 0x10203)
			assert.EqualValues(t, 0x10203, tt.msg.Sequence())
		})
	}
}

func TestRequestAndResponseClassification(t *testing.T) {
	assert.True(t, isRequest(message.NewHeartbeatRequest(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)), nil)))
	assert.False(t, isResponse(message.NewHeartbeatRequest(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)), nil)))

	assert.True(
		t,
		isResponse(message.NewHeartbeatResponse(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)))),
	)
	assert.False(
		t,
		isRequest(message.NewHeartbeatResponse(1, ie.NewRecoveryTimeStamp(time.Unix(1, 0)))),
	)
}
