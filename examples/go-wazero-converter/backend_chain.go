package converter

import (
	"context"
	"errors"
	"fmt"
)

var ErrBackendNotApplicable = errors.New("converter backend not applicable")

type BackendContext struct {
	WasmPath     string
	InputPath    string
	OutputPath   string
	SourceFormat string
	TargetFormat string
	Options      Options
}

type ConverterBackend interface {
	Name() string
	Convert(ctx context.Context, request BackendContext) (Result, error)
}

type ConverterBackendFunc struct {
	BackendName string
	Run         func(ctx context.Context, request BackendContext) (Result, error)
}

func (backend ConverterBackendFunc) Name() string {
	return backend.BackendName
}

func (backend ConverterBackendFunc) Convert(ctx context.Context, request BackendContext) (Result, error) {
	if backend.Run == nil {
		return Result{}, ErrBackendNotApplicable
	}
	return backend.Run(ctx, request)
}

type OrderedBackendChain struct {
	Backends []ConverterBackend
}

type BackendChainOptions struct {
	DisableWASIBackend bool
}

func (chain OrderedBackendChain) Convert(ctx context.Context, request BackendContext) (Result, error) {
	sourceFormat := normalizeFormat(request.SourceFormat)
	targetFormat := normalizeFormat(request.TargetFormat)
	if sourceFormat != "" && targetFormat != "" && !isSupportedConversionPair(sourceFormat, targetFormat) {
		return unsupportedConversionResult(sourceFormat, targetFormat), nil
	}

	var attempted bool
	var lastErr error

	for _, backend := range chain.Backends {
		if backend == nil {
			continue
		}
		attempted = true
		result, err := backend.Convert(ctx, request)
		if err == nil {
			return markResultBackend(result, backend.Name()), nil
		}
		if errors.Is(err, ErrBackendNotApplicable) {
			lastErr = err
			continue
		}
		return markResultBackend(result, backend.Name()), fmt.Errorf("%s backend failed: %w", backend.Name(), err)
	}

	if !attempted {
		return Result{}, errors.New("no converter backends configured")
	}
	if lastErr != nil {
		if isSupportedConversionPair(sourceFormat, targetFormat) {
			return engineUnavailableResult(sourceFormat, targetFormat), nil
		}
		return Result{}, lastErr
	}
	return Result{}, ErrBackendNotApplicable
}

func DefaultBackendChain() OrderedBackendChain {
	return NewBackendChain(BackendChainOptions{})
}

func NewBackendChain(options BackendChainOptions) OrderedBackendChain {
	backends := []ConverterBackend{}
	if !options.DisableWASIBackend {
		backends = append(backends, NewWASIBackend())
	}
	return OrderedBackendChain{
		Backends: backends,
	}
}

func (chain OrderedBackendChain) Close(ctx context.Context) error {
	var closeErr error
	for _, backend := range chain.Backends {
		closer, ok := backend.(interface {
			Close(context.Context) error
		})
		if !ok {
			continue
		}
		closeErr = errors.Join(closeErr, closer.Close(ctx))
	}
	return closeErr
}

func (options BackendChainOptions) RequiresWASM() bool {
	return !options.DisableWASIBackend
}

func (chain OrderedBackendChain) ConverterFunc() ConverterFunc {
	return func(
		ctx context.Context,
		wasmPath string,
		inputPath string,
		outputPath string,
		sourceFormat string,
		targetFormat string,
		opts Options,
	) (Result, error) {
		return chain.Convert(ctx, BackendContext{
			WasmPath:     wasmPath,
			InputPath:    inputPath,
			OutputPath:   outputPath,
			SourceFormat: sourceFormat,
			TargetFormat: targetFormat,
			Options:      opts,
		})
	}
}

func defaultConvert(
	ctx context.Context,
	wasmPath string,
	inputPath string,
	outputPath string,
	sourceFormat string,
	targetFormat string,
	opts Options,
) (Result, error) {
	chain := DefaultBackendChain()
	defer chain.Close(ctx)
	return chain.ConverterFunc()(ctx, wasmPath, inputPath, outputPath, sourceFormat, targetFormat, opts)
}

func markResultBackend(result Result, backendName string) Result {
	if result.Backend == "" {
		result.Backend = backendName
	}
	return markResultFidelity(result)
}

func unsupportedConversionResult(sourceFormat string, targetFormat string) Result {
	sourceFormat = normalizeFormat(sourceFormat)
	targetFormat = normalizeFormat(targetFormat)
	return Result{
		OK:           false,
		SourceFormat: sourceFormat,
		TargetFormat: targetFormat,
		ContentType:  contentTypeForFormat(targetFormat),
		Warnings:     []string{},
		ErrorCode:    ErrorCodeUnsupportedFormat,
		ErrorMessage: fmt.Sprintf("unsupported conversion pair: %s -> %s", sourceFormat, targetFormat),
	}
}

func engineUnavailableResult(sourceFormat string, targetFormat string) Result {
	sourceFormat = normalizeFormat(sourceFormat)
	targetFormat = normalizeFormat(targetFormat)
	return Result{
		OK:           false,
		SourceFormat: sourceFormat,
		TargetFormat: targetFormat,
		ContentType:  contentTypeForFormat(targetFormat),
		Warnings: []string{
			"No configured converter backend handled this request.",
		},
		ErrorCode:    ErrorCodeEngineUnavailable,
		ErrorMessage: fmt.Sprintf("no converter backend is available for %s -> %s", sourceFormat, targetFormat),
	}
}
