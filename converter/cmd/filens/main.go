package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/IceWhaleTech/filens/converter/agent"
	"github.com/IceWhaleTech/filens/converter/rapidocr"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--ocr-worker" {
		os.Exit(rapidocr.Worker(os.Stdin, os.Stdout))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	args := os.Args[1:]
	if len(args) == 0 {
		if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeCharDevice == 0 {
			args = []string{"-"}
		}
	}
	code := agent.Run(ctx, args, os.Stdin, os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
