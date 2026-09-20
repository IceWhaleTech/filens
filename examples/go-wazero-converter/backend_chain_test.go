package converter

import (
	"context"
	"errors"
	"testing"
)

func TestOrderedBackendChainSkipsNotApplicableBackends(t *testing.T) {
	chain := OrderedBackendChain{
		Backends: []ConverterBackend{
			ConverterBackendFunc{
				BackendName: "skip",
				Run: func(context.Context, BackendContext) (Result, error) {
					return Result{}, ErrBackendNotApplicable
				},
			},
			ConverterBackendFunc{
				BackendName: "mock",
				Run: func(_ context.Context, request BackendContext) (Result, error) {
					return Result{
						OK:           true,
						SourceFormat: request.SourceFormat,
						TargetFormat: request.TargetFormat,
					}, nil
				},
			},
		},
	}

	result, err := chain.Convert(context.Background(), BackendContext{
		SourceFormat: "doc",
		TargetFormat: "docx",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("expected ok result: %+v", result)
	}
	if result.Backend != "mock" {
		t.Fatalf("expected mock backend, got %q", result.Backend)
	}
	if result.Fidelity != "" {
		t.Fatalf("expected unknown custom backend to leave fidelity empty, got %q", result.Fidelity)
	}
}

func TestOrderedBackendChainStopsOnConcreteFailure(t *testing.T) {
	chain := OrderedBackendChain{
		Backends: []ConverterBackend{
			ConverterBackendFunc{
				BackendName: "failing",
				Run: func(context.Context, BackendContext) (Result, error) {
					return Result{}, errors.New("boom")
				},
			},
			ConverterBackendFunc{
				BackendName: "later",
				Run: func(context.Context, BackendContext) (Result, error) {
					t.Fatal("later backend should not run")
					return Result{}, nil
				},
			},
		},
	}

	_, err := chain.Convert(context.Background(), BackendContext{})
	if err == nil {
		t.Fatal("expected failure")
	}
	if err.Error() != "failing backend failed: boom" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestOrderedBackendChainFailsWhenNothingApplies(t *testing.T) {
	chain := OrderedBackendChain{
		Backends: []ConverterBackend{
			ConverterBackendFunc{
				BackendName: "skip",
				Run: func(context.Context, BackendContext) (Result, error) {
					return Result{}, ErrBackendNotApplicable
				},
			},
		},
	}

	_, err := chain.Convert(context.Background(), BackendContext{})
	if !errors.Is(err, ErrBackendNotApplicable) {
		t.Fatalf("expected ErrBackendNotApplicable, got %v", err)
	}
}

func TestOrderedBackendChainReturnsUnsupportedFormatBeforeBackends(t *testing.T) {
	chain := OrderedBackendChain{
		Backends: []ConverterBackend{
			ConverterBackendFunc{
				BackendName: "must-not-run",
				Run: func(context.Context, BackendContext) (Result, error) {
					t.Fatal("backend should not run for unsupported pair")
					return Result{}, nil
				},
			},
		},
	}

	result, err := chain.Convert(context.Background(), BackendContext{
		SourceFormat: "webp",
		TargetFormat: "png",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.OK || result.ErrorCode != ErrorCodeUnsupportedFormat {
		t.Fatalf("expected unsupported_format result, got %+v", result)
	}
	if result.SourceFormat != "webp" || result.TargetFormat != "png" {
		t.Fatalf("unexpected formats: %+v", result)
	}
}

func TestOrderedBackendChainReturnsEngineUnavailableWhenNoBackendApplies(t *testing.T) {
	chain := OrderedBackendChain{
		Backends: []ConverterBackend{
			ConverterBackendFunc{
				BackendName: "skip",
				Run: func(context.Context, BackendContext) (Result, error) {
					return Result{}, ErrBackendNotApplicable
				},
			},
		},
	}

	result, err := chain.Convert(context.Background(), BackendContext{
		SourceFormat: "doc",
		TargetFormat: "docx",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.OK || result.ErrorCode != ErrorCodeEngineUnavailable {
		t.Fatalf("expected engine_unavailable result, got %+v", result)
	}
}

func TestDefaultBackendChainUsesWASIOnly(t *testing.T) {
	chain := DefaultBackendChain()
	if len(chain.Backends) != 1 {
		t.Fatalf("unexpected default backend count: %d", len(chain.Backends))
	}
	if chain.Backends[0].Name() != "wasi" {
		t.Fatalf("unexpected default backend: %s", chain.Backends[0].Name())
	}
}

func TestNewBackendChainCanDisableWASIWrapper(t *testing.T) {
	chain := NewBackendChain(BackendChainOptions{
		DisableWASIBackend: true,
	})
	if len(chain.Backends) != 0 {
		t.Fatalf("unexpected backend count: %d", len(chain.Backends))
	}
}
