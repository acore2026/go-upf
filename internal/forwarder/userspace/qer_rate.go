package userspace

import "time"

func (d *Driver) mbrAllows(binding *PDRBinding, bytes int, direction PacketDirection) bool {
	if binding == nil || len(binding.QERs) == 0 || bytes <= 0 {
		return true
	}

	now := time.Now().UTC()

	d.mu.Lock()
	defer d.mu.Unlock()

	sess := d.sessions[binding.SEID]
	if sess == nil {
		return true
	}

	for _, qer := range binding.QERs {
		if qer == nil {
			continue
		}
		mbr := d.effectiveQERMBRLocked(sess, binding, qer, direction, now)
		if mbr == 0 {
			continue
		}
		meter := sess.QERMeters[qer.ID]
		if meter == nil {
			meter = &QERMeterState{}
			sess.QERMeters[qer.ID] = meter
		}
		bucket := selectQERBucket(meter, direction)
		if !consumeTokens(bucket, mbr, bytes, now) {
			return false
		}
	}

	return true
}

func qerMBR(qer *QERRule, direction PacketDirection) uint64 {
	if qer == nil {
		return 0
	}
	switch direction {
	case PacketDirectionUplink:
		if qer.MBRUL != nil {
			return *qer.MBRUL
		}
	case PacketDirectionDownlink:
		if qer.MBRDL != nil {
			return *qer.MBRDL
		}
	}
	return 0
}

func (d *Driver) effectiveQEROverride(seid uint64, qerID uint32) *AdaptiveQEROverride {
	d.mu.RLock()
	defer d.mu.RUnlock()

	sess := d.sessions[seid]
	return effectiveQEROverrideFromSession(sess, qerID, time.Now().UTC())
}

func effectiveQEROverrideFromSession(sess *SessionState, qerID uint32, now time.Time) *AdaptiveQEROverride {
	if sess == nil {
		return nil
	}
	override := sess.AdaptiveQER[adaptiveQERKey(qerID)]
	if override == nil {
		return nil
	}
	if !override.ExpiresAt.IsZero() && now.After(override.ExpiresAt) {
		return nil
	}
	return override
}

func (d *Driver) effectiveQERGateClosed(binding *PDRBinding, qer *QERRule, direction PacketDirection) bool {
	if qer == nil {
		return false
	}

	if override := d.effectiveQEROverride(binding.SEID, qer.ID); override != nil {
		switch direction {
		case PacketDirectionUplink:
			if override.OverrideGateUL != nil {
				return !*override.OverrideGateUL
			}
		case PacketDirectionDownlink:
			if override.OverrideGateDL != nil {
				return !*override.OverrideGateDL
			}
		}
	}

	if qer.GateStatus == nil {
		return false
	}
	switch direction {
	case PacketDirectionUplink:
		return *qer.GateStatus&qerULGateClosed != 0
	case PacketDirectionDownlink:
		return *qer.GateStatus&qerDLGateClosed != 0
	default:
		return false
	}
}

func (d *Driver) effectiveQERMBR(binding *PDRBinding, qer *QERRule, direction PacketDirection) uint64 {
	return d.effectiveQERMBRLocked(nil, binding, qer, direction, time.Now().UTC())
}

func (d *Driver) effectiveQERMBRLocked(sess *SessionState, binding *PDRBinding, qer *QERRule, direction PacketDirection, now time.Time) uint64 {
	if qer == nil {
		return 0
	}

	override := effectiveQEROverrideFromSession(sess, qer.ID, now)
	if override == nil && sess == nil {
		override = d.effectiveQEROverride(binding.SEID, qer.ID)
	}
	if override != nil {
		switch direction {
		case PacketDirectionUplink:
			if override.OverrideMBRUL != 0 {
				return override.OverrideMBRUL
			}
		case PacketDirectionDownlink:
			if override.OverrideMBRDL != 0 {
				return override.OverrideMBRDL
			}
		}
	}

	return qerMBR(qer, direction)
}

func selectQERBucket(meter *QERMeterState, direction PacketDirection) *tokenBucket {
	switch direction {
	case PacketDirectionDownlink:
		return &meter.Downlink
	default:
		return &meter.Uplink
	}
}

func consumeTokens(bucket *tokenBucket, mbrBitsPerSecond uint64, bytes int, now time.Time) bool {
	// PFCP MBR/GBR values are encoded in kilobits per second.
	rateBytesPerSecond := (float64(mbrBitsPerSecond) * 1000.0) / 8.0
	if rateBytesPerSecond <= 0 {
		return true
	}

	if bucket.LastRefill.IsZero() {
		bucket.LastRefill = now
		bucket.Tokens = rateBytesPerSecond
	} else if now.After(bucket.LastRefill) {
		elapsed := now.Sub(bucket.LastRefill).Seconds()
		bucket.Tokens += elapsed * rateBytesPerSecond
		if bucket.Tokens > rateBytesPerSecond {
			bucket.Tokens = rateBytesPerSecond
		}
		bucket.LastRefill = now
	}

	need := float64(bytes)
	if bucket.Tokens < need {
		return false
	}
	bucket.Tokens -= need
	return true
}
