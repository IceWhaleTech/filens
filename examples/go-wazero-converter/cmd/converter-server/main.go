package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"time"

	converter "github.com/IceWhaleTech/filens/examples/go-wazero-converter"
)

func main() {
	addr := flag.String("addr", envOr("CONVERTER_ADDR", "127.0.0.1:8080"), "HTTP listen address")
	path := flag.String("path", envOr("CONVERTER_PATH", "/convert"), "HTTP converter endpoint path")
	healthPath := flag.String("health-path", envOr("CONVERTER_HEALTH_PATH", "/healthz"), "HTTP health/capabilities endpoint path, or empty to disable")
	wasmPath := flag.String("wasm", os.Getenv("CONVERTER_CORE_WASM"), "path to converter-core.wasm")
	maxUploadMB := flag.Int64("max-upload-mb", envInt64("CONVERTER_MAX_UPLOAD_MB", 512), "maximum multipart upload size in MiB")
	allowOrigin := flag.String("allow-origin", os.Getenv("CONVERTER_ALLOW_ORIGIN"), "optional CORS Access-Control-Allow-Origin value")
	flag.Parse()

	backendChain := converter.BackendChainOptions{}
	if *wasmPath == "" {
		log.Fatal("missing --wasm or CONVERTER_CORE_WASM")
	}
	absWasmPath := ""
	if *wasmPath != "" {
		var err error
		absWasmPath, err = filepath.Abs(*wasmPath)
		if err != nil {
			log.Fatalf("resolve wasm path: %v", err)
		}
	}

	mux := http.NewServeMux()
	mux.Handle(*path, withCORS(converter.NewHTTPHandler(converter.HTTPHandlerOptions{
		WasmPath:       absWasmPath,
		MaxUploadBytes: *maxUploadMB << 20,
		BackendChain:   backendChain,
	}), *allowOrigin, "POST, OPTIONS"))
	if *healthPath != "" {
		if *healthPath == *path {
			log.Fatal("--health-path must differ from --path")
		}
		mux.Handle(*healthPath, withCORS(converter.NewHealthHandler(converter.HealthHandlerOptions{
			WasmPath:     absWasmPath,
			BackendChain: backendChain,
		}), *allowOrigin, "GET, HEAD, OPTIONS"))
	}

	server := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("converter server listening on http://%s%s", *addr, *path)
		if *healthPath != "" {
			log.Printf("converter health available on http://%s%s", *addr, *healthPath)
		}
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Fatalf("shutdown server: %v", err)
		}
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve converter: %v", err)
		}
	}
}

func withCORS(handler http.Handler, allowOrigin string, allowMethods string) http.Handler {
	if allowOrigin == "" {
		return handler
	}
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		response.Header().Set("Access-Control-Allow-Methods", allowMethods)
		response.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		response.Header().Set("Vary", "Origin")
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		handler.ServeHTTP(response, request)
	})
}

func envOr(name string, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	return value
}

func envInt64(name string, fallback int64) int64 {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	var parsed int64
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
