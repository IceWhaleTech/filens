//go:build darwin || linux

package rapidocr

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"github.com/ebitengine/purego"
)

type jsonFunction func(unsafe.Pointer, uintptr, unsafe.Pointer, uintptr) uintptr
type nativeRuntime struct {
	handle                       uint64
	create, destroy, load, infer jsonFunction
}

func openNative(library, models string) (result *nativeRuntime, err error) {
	if library == "" || models == "" {
		return nil, errors.New("RapidOCR NCNN library and model directory are required")
	}
	companion := "libncnn.so"
	if runtime.GOOS == "darwin" {
		companion = "libncnn.dylib"
	}
	companion = filepath.Join(filepath.Dir(library), companion)
	if _, err := os.Stat(companion); err != nil {
		return nil, fmt.Errorf("NCNN companion: %w", err)
	}
	if err := os.Setenv("ZIMAOS_NCNN_NATIVE_LIBRARY_PATH", companion); err != nil {
		return nil, err
	}
	// Both libraries use absolute paths; no system NCNN, Python or Homebrew is needed.
	if _, err := purego.Dlopen(companion, purego.RTLD_NOW|purego.RTLD_GLOBAL); err != nil {
		return nil, fmt.Errorf("open NCNN: %w", err)
	}
	lib, err := purego.Dlopen(library, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return nil, fmt.Errorf("open OCR runtime: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			result = nil
			err = fmt.Errorf("NCNN JSON ABI: %v", p)
		}
	}()
	n := &nativeRuntime{}
	for name, target := range map[string]*jsonFunction{"create": &n.create, "destroy": &n.destroy, "load": &n.load, "infer": &n.infer} {
		purego.RegisterLibFunc(target, lib, "zima_ncnn_"+name+"_json_v2")
	}
	var created struct {
		Handle uint64 `json:"handle_id"`
	}
	if err := nativeCall(n.create, map[string]any{}, &created); err != nil {
		return nil, err
	}
	n.handle = created.Handle
	if n.handle == 0 {
		return nil, errors.New("NCNN returned an invalid handle")
	}
	var loaded struct {
		Backend   string `json:"backend_effective"`
		Detection bool   `json:"ocr_detection_outcome"`
		Degrade   string `json:"degrade_reason"`
	}
	err = nativeCall(n.load, map[string]any{"handle_id": n.handle, "model_class": "ocr", "bundle_id": "rapidocr-ncnn", "bundle_path": models, "backend_candidates": []string{"cpu"}, "allow_cpu_fallback": true, "thread_limit": 2}, &loaded)
	if err == nil && (loaded.Backend != "cpu" || !loaded.Detection) {
		err = fmt.Errorf("native OCR unavailable: %s", loaded.Degrade)
	}
	if err != nil {
		n.close()
		return nil, err
	}
	return n, nil
}

func (n *nativeRuntime) close() {
	_ = nativeCall(n.destroy, map[string]any{"handle_id": n.handle}, new(any))
}

func (n *nativeRuntime) recognize(path string, deadline int64) (string, error) {
	output, err := n.recognizeOutput(path, deadline)
	if err != nil {
		return "", err
	}
	var value struct {
		Text string `json:"text"`
	}
	err = json.Unmarshal(output, &value)
	return value.Text, err
}

func (n *nativeRuntime) recognizeOutput(path string, deadline int64) (json.RawMessage, error) {
	var response struct {
		Output json.RawMessage `json:"output"`
	}
	err := nativeCall(n.infer, map[string]any{
		"handle_id": n.handle, "model_class": "ocr", "bundle_id": "rapidocr-ncnn", "task": "ocr", "thread_limit": 2, "deadline_unix_milli": deadline,
		"input": map[string]any{"image": path, "params": map[string]any{"padding": 50, "max_side_len": 960, "box_score_thresh": 0.3, "box_thresh": 0.3, "unclip_ratio": 1.6, "run_det": true, "run_cls": true, "run_rec": true, "do_angle": true, "most_angle": false}},
	}, &response)
	if err != nil {
		return nil, err
	}
	var status struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.Output, &status); err != nil {
		return nil, err
	}
	if !status.OK {
		return nil, fmt.Errorf("native OCR failed: %s", status.Error)
	}
	return response.Output, nil
}

func nativeCall(fn jsonFunction, request, response any) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	payload = append(payload, 0)
	buffer := make([]byte, 4<<20)
	size := fn(unsafe.Pointer(&payload[0]), uintptr(len(payload)-1), unsafe.Pointer(&buffer[0]), uintptr(len(buffer)))
	runtime.KeepAlive(payload)
	if size == 0 || size > uintptr(len(buffer)) {
		return errors.New("invalid NCNN response length")
	}
	buffer = bytes.TrimRight(buffer[:int(size)], "\x00")
	var failure struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(buffer, &failure); err != nil {
		return fmt.Errorf("NCNN JSON response: %w", err)
	}
	if failure.Error != "" {
		return errors.New(failure.Error)
	}
	return json.Unmarshal(buffer, response)
}
