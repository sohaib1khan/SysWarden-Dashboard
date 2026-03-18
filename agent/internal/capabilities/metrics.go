// Package metrics implements the sys.metrics capability.
// It collects CPU, memory, disk, load average, swap, uptime and network I/O
// using gopsutil and returns them as MetricPoint values ready to POST to the backend.
package capabilities

import (
	"fmt"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gnet "github.com/shirou/gopsutil/v3/net"
)

// MetricPoint mirrors the backend's MetricPoint schema.
type MetricPoint struct {
	Name      string    `json:"name"`
	Value     float64   `json:"value"`
	Unit      string    `json:"unit,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// network I/O delta state — protected by a mutex so it's safe if ever called
// from multiple goroutines (e.g. future plugin parallelism).
var (
	netMu       sync.Mutex
	lastNetTime time.Time
	lastNetRecv uint64
	lastNetSent uint64
)

// calcNetRate returns aggregate network receive/send rates in KB/s since the
// previous call. Returns 0, 0 on the very first call (no baseline yet).
func calcNetRate() (rxKBs, txKBs float64) {
	counters, err := gnet.IOCounters(false) // false = aggregate all interfaces
	if err != nil || len(counters) == 0 {
		return 0, 0
	}
	now := time.Now()
	newRecv := counters[0].BytesRecv
	newSent := counters[0].BytesSent

	netMu.Lock()
	defer netMu.Unlock()

	if !lastNetTime.IsZero() {
		secs := now.Sub(lastNetTime).Seconds()
		if secs >= 0.5 {
			rx := float64(newRecv-lastNetRecv) / 1024 / secs
			tx := float64(newSent-lastNetSent) / 1024 / secs
			// Guard against counter wraps or reboots
			if rx >= 0 {
				rxKBs = round2(rx)
			}
			if tx >= 0 {
				txKBs = round2(tx)
			}
		}
	}

	lastNetTime = now
	lastNetRecv = newRecv
	lastNetSent = newSent
	return
}

// CollectSystemMetrics gathers all system metrics automatically every push interval.
// Metrics collected: CPU, memory, disk, load average (1/5/15 min), uptime,
// swap usage, and network I/O rates. Non-fatal sub-collectors (load, host, swap,
// net) are skipped gracefully on unsupported platforms.
func CollectSystemMetrics() ([]MetricPoint, error) {
	now := time.Now().UTC()

	// CPU — 200ms sample window
	cpuPcts, err := cpu.Percent(200*time.Millisecond, false)
	if err != nil {
		return nil, fmt.Errorf("cpu.Percent: %w", err)
	}
	cpuVal := 0.0
	if len(cpuPcts) > 0 {
		cpuVal = cpuPcts[0]
	}

	// Memory (virtual)
	vm, err := mem.VirtualMemory()
	if err != nil {
		return nil, fmt.Errorf("mem.VirtualMemory: %w", err)
	}

	// Disk — root partition
	du, err := disk.Usage("/")
	if err != nil {
		return nil, fmt.Errorf("disk.Usage: %w", err)
	}

	// Network I/O rates (non-fatal)
	rxKBs, txKBs := calcNetRate()

	pts := []MetricPoint{
		{Name: "sys.cpu.percent",  Value: round2(cpuVal),                              Unit: "%",    Timestamp: now},
		{Name: "sys.mem.percent",  Value: round2(vm.UsedPercent),                      Unit: "%",    Timestamp: now},
		{Name: "sys.mem.used_mb",  Value: round2(float64(vm.Used) / 1024 / 1024),      Unit: "MB",   Timestamp: now},
		{Name: "sys.mem.total_mb", Value: round2(float64(vm.Total) / 1024 / 1024),     Unit: "MB",   Timestamp: now},
		{Name: "sys.disk.percent", Value: round2(du.UsedPercent),                      Unit: "%",    Timestamp: now},
		{Name: "sys.disk.used_gb", Value: round2(float64(du.Used) / 1024 / 1024 / 1024),  Unit: "GB", Timestamp: now},
		{Name: "sys.disk.total_gb",Value: round2(float64(du.Total) / 1024 / 1024 / 1024), Unit: "GB", Timestamp: now},
		{Name: "sys.net.rx_kb_s",  Value: rxKBs,                                       Unit: "KB/s", Timestamp: now},
		{Name: "sys.net.tx_kb_s",  Value: txKBs,                                       Unit: "KB/s", Timestamp: now},
	}

	// Load average (non-fatal — Windows does not support this)
	if avg, err := load.Avg(); err == nil && avg != nil {
		pts = append(pts,
			MetricPoint{Name: "sys.load.1",  Value: round2(avg.Load1),  Unit: "", Timestamp: now},
			MetricPoint{Name: "sys.load.5",  Value: round2(avg.Load5),  Unit: "", Timestamp: now},
			MetricPoint{Name: "sys.load.15", Value: round2(avg.Load15), Unit: "", Timestamp: now},
		)
	}

	// Uptime (non-fatal)
	if hi, err := host.Info(); err == nil && hi != nil {
		pts = append(pts,
			MetricPoint{Name: "sys.uptime_s", Value: float64(hi.Uptime), Unit: "s", Timestamp: now},
		)
	}

	// Swap (non-fatal)
	if sw, err := mem.SwapMemory(); err == nil && sw != nil {
		pts = append(pts,
			MetricPoint{Name: "sys.swap.percent",  Value: round2(sw.UsedPercent),                    Unit: "%",  Timestamp: now},
			MetricPoint{Name: "sys.swap.used_mb",  Value: round2(float64(sw.Used) / 1024 / 1024),   Unit: "MB", Timestamp: now},
			MetricPoint{Name: "sys.swap.total_mb", Value: round2(float64(sw.Total) / 1024 / 1024),  Unit: "MB", Timestamp: now},
		)
	}

	return pts, nil
}

func round2(v float64) float64 {
	return float64(int(v*100)) / 100
}
