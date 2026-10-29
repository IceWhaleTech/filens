package rapidocr

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"time"
)

// Worker runs in an isolated copy of the CLI. The native runtime owns image
// preprocessing and inference. Document parsing and OCR decisions stay in WASM.
func Worker(input io.Reader, output io.Writer) int {
	native, err := openNative(os.Getenv("FILENS_OCR_LIBRARY"), os.Getenv("FILENS_OCR_MODEL_DIR"))
	encoder := json.NewEncoder(output)
	if err != nil {
		_ = encoder.Encode(map[string]any{"error": err.Error()})
		return 1
	}
	defer native.close()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	for scanner.Scan() {
		var request struct {
			Operation string `json:"operation"`
			Path      string `json:"path"`
			Deadline  int64  `json:"deadline"`
			Layout    bool   `json:"layout"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			_ = encoder.Encode(map[string]any{"error": err.Error()})
			continue
		}
		response := map[string]any{"provider": "rapidocr-ncnn", "openmpThreads": 2, "maxSideLen": 960}
		if request.Operation != "health" {
			deadline := request.Deadline
			if deadline == 0 {
				deadline = time.Now().Add(30 * time.Second).UnixMilli()
			}
			value, err := native.recognizeOutput(request.Path, deadline)
			if err != nil {
				response["error"] = err.Error()
			} else {
				var output map[string]json.RawMessage
				if err := json.Unmarshal(value, &output); err != nil {
					response["error"] = err.Error()
				} else {
					response["text"] = output["text"]
					if request.Layout {
						response["detail"] = value
					}
				}
			}
		}
		if err := encoder.Encode(response); err != nil {
			return 1
		}
	}
	if scanner.Err() != nil {
		return 1
	}
	return 0
}
