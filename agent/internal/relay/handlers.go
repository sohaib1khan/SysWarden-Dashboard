package relay

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
)

// HandlerRegistry is a thread-safe registry of CapabilityHandlers.
// It replaces the static map[string]CapabilityHandler so the plugin loader
// can register new handlers at runtime without redeploying the agent binary.
type HandlerRegistry struct {
	mu       sync.RWMutex
	handlers map[string]CapabilityHandler
}

// NewHandlerRegistry returns an empty registry ready for concurrent use.
func NewHandlerRegistry() *HandlerRegistry {
	return &HandlerRegistry{handlers: make(map[string]CapabilityHandler)}
}

// Set registers (or replaces) the handler for the given capability name.
// Safe to call from any goroutine at any time.
func (r *HandlerRegistry) Set(name string, h CapabilityHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[name] = h
}

// Get returns the handler for name and whether it was found.
func (r *HandlerRegistry) Get(name string) (CapabilityHandler, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	h, ok := r.handlers[name]
	return h, ok
}

// Names returns a sorted snapshot of all registered capability names.
func (r *HandlerRegistry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.handlers))
	for name := range r.handlers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Has reports whether a capability is currently registered.
func (r *HandlerRegistry) Has(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.handlers[name]
	return ok
}

// SetHandler satisfies the plugins.HandlerRegistrar interface without creating
// an import cycle. The signature must exactly match HandlerRegistrar.SetHandler.
func (r *HandlerRegistry) SetHandler(name string, h func(context.Context, json.RawMessage) (interface{}, error)) {
	r.Set(name, CapabilityHandler(h))
}
