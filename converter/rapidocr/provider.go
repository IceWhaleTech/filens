// Package rapidocr implements the default OCR capability as an isolated local
// process. File parsing and decisions about OCR remain in the WASM core.
package rapidocr

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
)

type Provider struct {
	Executable string
	Library    string
	ModelDir   string
	Stderr     io.Writer
	mu         sync.Mutex
	command    *exec.Cmd
	input      io.WriteCloser
	output     *bufio.Scanner
	wait       chan error
}

func (p *Provider) start(ctx context.Context) error {
	if p.command != nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.Library == "" {
		return errors.New("RapidOCR NCNN runtime is unavailable; install OCR with filens setup-ocr")
	}
	// A unit's context is canceled after its result, so it must not own the
	// persistent worker. call() enforces cancellation and Close owns shutdown.
	executable := p.Executable
	if executable == "" {
		executable, _ = os.Executable()
	}
	p.command = exec.Command(executable, "--ocr-worker")
	p.command.Env = append(os.Environ(), "OMP_NUM_THREADS=2", "OMP_THREAD_LIMIT=2", "GOMAXPROCS=2", "FILENS_OCR_LIBRARY="+p.Library)
	if p.ModelDir != "" {
		p.command.Env = append(p.command.Env, "FILENS_OCR_MODEL_DIR="+p.ModelDir)
	}
	p.command.Stderr = p.Stderr
	var err error
	p.input, err = p.command.StdinPipe()
	if err != nil {
		p.command = nil
		return err
	}
	output, err := p.command.StdoutPipe()
	if err != nil {
		_ = p.input.Close()
		p.command = nil
		return err
	}
	if err := p.command.Start(); err != nil {
		_ = p.input.Close()
		p.command = nil
		return fmt.Errorf("start RapidOCR NCNN: %w", err)
	}
	p.output = bufio.NewScanner(output)
	p.output.Buffer(make([]byte, 4096), 4<<20)
	p.wait = make(chan error, 1)
	command, wait := p.command, p.wait
	go func() { wait <- command.Wait() }()
	return nil
}

func (p *Provider) call(ctx context.Context, request any) (map[string]json.RawMessage, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := p.start(ctx); err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			_ = p.closeLocked()
		}
	}()
	// A canceled OCR unit kills the process, including uncooperative inference.
	command := p.command
	stop := context.AfterFunc(ctx, func() { _ = command.Process.Kill() })
	defer stop()
	if err := json.NewEncoder(p.input).Encode(request); err != nil {
		return nil, err
	}
	if !p.output.Scan() {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err := p.output.Err(); err != nil {
			return nil, err
		}
		return nil, errors.New("RapidOCR worker exited; check the bundled runtime and models")
	}
	var response map[string]json.RawMessage
	if err := json.Unmarshal(p.output.Bytes(), &response); err != nil {
		return nil, fmt.Errorf("RapidOCR response: %w", err)
	}
	var failure string
	_ = json.Unmarshal(response["error"], &failure)
	if failure != "" {
		return nil, errors.New(failure)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	success = true
	return response, nil
}

func (p *Provider) Recognize(ctx context.Context, path string) (string, error) {
	request := map[string]any{"path": path}
	if deadline, ok := ctx.Deadline(); ok {
		request["deadline"] = deadline.UnixMilli()
	}
	r, err := p.call(ctx, request)
	if err != nil {
		return "", err
	}
	var text string
	if err := json.Unmarshal(r["text"], &text); err != nil {
		return "", err
	}
	return text, nil
}

func (p *Provider) RecognizeLayout(ctx context.Context, path string) (json.RawMessage, error) {
	request := map[string]any{"path": path, "layout": true}
	if deadline, ok := ctx.Deadline(); ok {
		request["deadline"] = deadline.UnixMilli()
	}
	r, err := p.call(ctx, request)
	if err != nil {
		return nil, err
	}
	return json.Marshal(r)
}

func (p *Provider) Health(ctx context.Context) error {
	r, err := p.call(ctx, map[string]string{"operation": "health"})
	if err != nil {
		return err
	}
	if string(r["openmpThreads"]) != "2" || string(r["provider"]) != `"rapidocr-ncnn"` || string(r["maxSideLen"]) != "960" {
		return errors.New("unexpected RapidOCR health response")
	}
	return nil
}

func (p *Provider) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.closeLocked()
}

func (p *Provider) closeLocked() error {
	if p.command == nil {
		return nil
	}
	_ = p.input.Close()
	_ = p.command.Process.Kill()
	err := <-p.wait
	p.command = nil
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return nil
	}
	return err
}
