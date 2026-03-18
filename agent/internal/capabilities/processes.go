package capabilities

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/shirou/gopsutil/v3/process"
)

// ProcessInfo is what we return for each process.
type ProcessInfo struct {
	PID     int32   `json:"pid"`
	Name    string  `json:"name"`
	CPUPct  float64 `json:"cpu_pct"`
	MemMB   float64 `json:"mem_mb"`
	Status  string  `json:"status"`
}

// CollectProcesses returns the top N processes sorted by CPU descending.
// params: { "limit": 20 }
func CollectProcesses(_ context.Context, params json.RawMessage) (interface{}, error) {
	var p struct {
		Limit int `json:"limit"`
	}
	p.Limit = 20
	if params != nil {
		_ = json.Unmarshal(params, &p)
	}
	if p.Limit <= 0 || p.Limit > 200 {
		p.Limit = 20
	}

	procs, err := process.Processes()
	if err != nil {
		return nil, fmt.Errorf("process.Processes: %w", err)
	}

	var results []ProcessInfo
	for _, proc := range procs {
		name, _ := proc.Name()
		cpu, _ := proc.CPUPercent()
		mem, _ := proc.MemoryInfo()

		memMB := 0.0
		if mem != nil {
			memMB = round2(float64(mem.RSS) / 1024 / 1024)
		}

		statuses, _ := proc.Status()
		status := ""
		if len(statuses) > 0 {
			status = statuses[0]
		}

		results = append(results, ProcessInfo{
			PID:    proc.Pid,
			Name:   name,
			CPUPct: round2(cpu),
			MemMB:  memMB,
			Status: status,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].CPUPct > results[j].CPUPct
	})

	if len(results) > p.Limit {
		results = results[:p.Limit]
	}
	return results, nil
}
