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
		mbr := qerMBR(qer, direction)
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
