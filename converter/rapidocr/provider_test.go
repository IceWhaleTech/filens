package rapidocr

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWorkerSurvivesCompletedUnitAndCanBeCanceled(t *testing.T) {
	executable, _ := filepath.Abs(filepath.Join("..", "..", "dist", "filens"))
	libraryName := "libzima_ncnn_runtime_v7.so"
	if runtime.GOOS == "darwin" {
		libraryName = "libzima_ncnn_runtime_v7.dylib"
	}
	library, _ := filepath.Abs(filepath.Join("..", "..", "dist", "native", libraryName))
	if _, err := os.Stat(library); err != nil {
		t.Skip("build the OCR bundle with npm run build:agent")
	}
	models, _ := filepath.Abs(filepath.Join("..", "..", "dist", "models", "rapidocr-ncnn"))
	p := &Provider{Executable: executable, Library: library, ModelDir: models, Stderr: os.Stderr}
	t.Cleanup(func() { _ = p.Close() })
	first, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := p.Health(first); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	second, cancelSecond := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelSecond()
	if err := p.Health(second); err != nil {
		t.Fatalf("completed OCR unit killed the reusable worker: %v", err)
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	if _, err := p.Recognize(canceled, "unused.png"); err == nil {
		t.Fatal("canceled inference succeeded")
	}
}

// The fake worker deliberately ignores cancellation, just as native inference
// can. Verify that the host kills it and starts a fresh worker for the next unit.
func TestHardTimeoutReapsWorkerAndAllowsNextUnit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix launcher fixture")
	}
	testBinary, _ := os.Executable()
	launcher := filepath.Join(t.TempDir(), "worker")
	script := "#!/bin/sh\nexec " + "'" + strings.ReplaceAll(testBinary, "'", "'\\''") + "'" + " -test.run=^TestWorkerProcess$\n"
	if err := os.WriteFile(launcher, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FILENS_OCR_TEST_WORKER", "1")
	p := &Provider{Executable: launcher, Library: "test", Stderr: os.Stderr}
	defer p.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := p.Recognize(ctx, "block"); err != context.DeadlineExceeded {
		t.Fatalf("got %v", err)
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("worker was not stopped promptly")
	}
	if err := p.Health(context.Background()); err != nil {
		t.Fatalf("worker did not recover: %v", err)
	}
}

func TestWorkerProcess(t *testing.T) {
	if os.Getenv("FILENS_OCR_TEST_WORKER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request map[string]any
		_ = json.Unmarshal(scanner.Bytes(), &request)
		if request["path"] == "block" {
			time.Sleep(10 * time.Second)
		}
		fmt.Println(`{"provider":"rapidocr-ncnn","openmpThreads":2,"maxSideLen":960}`)
	}
	os.Exit(0)
}
