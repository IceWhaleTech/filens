//go:build !darwin && !linux

package rapidocr

import (
	"encoding/json"
	"errors"
)

type nativeRuntime struct{}

func openNative(_, _ string) (*nativeRuntime, error) {
	return nil, errors.New("RapidOCR NCNN is supported on macOS arm64 and Linux amd64/arm64")
}
func (*nativeRuntime) close() {}
func (*nativeRuntime) recognize(string, int64) (string, error) {
	return "", errors.New("native OCR unavailable")
}
func (*nativeRuntime) recognizeOutput(string, int64) (json.RawMessage, error) {
	return nil, errors.New("native OCR unavailable")
}
