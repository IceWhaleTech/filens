// Package agent exposes local file-reading capabilities to humans and agents.
// It interprets requests and maps results; format parsing stays in WASM.
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/IceWhaleTech/filens/converter"
)

const Protocol = "filens-agent-v1"

type Request struct {
	Intent    string `json:"intent,omitempty"`
	Input     string `json:"input,omitempty"`
	Operation string `json:"operation,omitempty"`
	Format    string `json:"format,omitempty"`
	MaxBytes  int    `json:"maxBytes,omitempty"`
	Layout    bool   `json:"layout,omitempty"`
}

type cliOptions struct {
	Request
	wasm       string
	ocr        bool
	timeout    time.Duration
	help       bool
	structured bool
}

var quotedPath = regexp.MustCompile(`["'“‘]([^"'”’]+)["'”’]`)
var barePath = regexp.MustCompile(`[^\s"'“”‘’，。；：！？,;!?<>]+\.[a-zA-Z0-9]{1,12}`)
var jsonIntent = regexp.MustCompile(`(?i)(\b(?:as|in)\s+json\b|\bjson\s+(?:format|output)\b|(?:以|用|为|返回|输出)\s*json\b|\bjson\s*(?:格式|输出|返回))`)
var textIntent = regexp.MustCompile(`(?i)(\b(?:as|in)\s+(?:plain\s+)?text\b|纯文本|文本格式)`)
var outputIntent = regexp.MustCompile(`(?i)(?:\b(?:as|in|output|return)\s+(?:plain\s+)?|(?:以|用|输出|返回)\s*)(json|yaml|yml|markdown|md|html|htm|csv|tsv|xml|text|txt)\b`)
var outputSuffix = regexp.MustCompile(`(?i)\b(json|yaml|yml|markdown|md|html|csv|tsv|xml|text)\s*(?:format|output|格式|输出|返回)`)
var layoutIntent = regexp.MustCompile(`(?i)\b(?:layout|coordinates|bounding\s+boxes)\b|布局|版面|坐标`)
var outputFormats = []string{"text", "json", "markdown", "html", "yaml", "xml", "csv", "tsv"}

func normalizeFormat(format string) string {
	format = strings.ToLower(strings.TrimSpace(format))
	switch format {
	case "txt", "plain", "plain text":
		return "text"
	case "md":
		return "markdown"
	case "yml":
		return "yaml"
	case "htm":
		return "html"
	}
	return format
}
func validFormat(format string) bool {
	for _, candidate := range outputFormats {
		if candidate == format {
			return true
		}
	}
	return false
}

func parseCLI(args []string, stdin io.Reader) (cliOptions, error) {
	o := cliOptions{ocr: true, timeout: 2 * time.Minute}
	// Decide the error channel even if an invalid option precedes --json.
	for i, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--json" || arg == "--format=json" || (arg == "--format" && i+1 < len(args) && args[i+1] == "json") {
			o.Format = "json"
		}
		if strings.HasPrefix(arg, "--format=") {
			if format := normalizeFormat(strings.TrimPrefix(arg, "--format=")); validFormat(format) {
				o.Format = format
			}
		}
		if arg == "--format" && i+1 < len(args) {
			if format := normalizeFormat(args[i+1]); validFormat(format) {
				o.Format = format
			}
		}
	}
	var positional []string
	var explicitFormat string
	stdinRequest := false
	flags := true
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if flags && arg == "--" {
			flags = false
			continue
		}
		if !flags || !strings.HasPrefix(arg, "-") || arg == "-" {
			if flags && arg == "-" {
				stdinRequest = true
			} else {
				positional = append(positional, arg)
			}
			continue
		}
		name, inline, hasInline := strings.Cut(arg, "=")
		value := func() (string, error) {
			if hasInline {
				return inline, nil
			}
			i++
			if i >= len(args) {
				return "", fmt.Errorf("%s needs a value", name)
			}
			return args[i], nil
		}
		switch name {
		case "--help", "-h":
			o.help = true
		case "--json":
			explicitFormat = "json"
			o.Format = "json"
		case "--capabilities", "--capacity":
			o.Operation = "capabilities"
		case "--no-ocr":
			o.ocr = false
		case "--layout":
			o.Layout = true
		case "--format", "--input", "--wasm", "--max-bytes", "--timeout":
			v, err := value()
			if err != nil {
				return o, err
			}
			switch name {
			case "--format":
				explicitFormat = v
				o.Format = v
			case "--input":
				o.Input = v
			case "--wasm":
				o.wasm = v
			case "--max-bytes":
				o.MaxBytes, err = strconv.Atoi(v)
			case "--timeout":
				o.timeout, err = time.ParseDuration(v)
			}
			if err != nil {
				return o, fmt.Errorf("%s: %w", name, err)
			}
		default:
			return o, fmt.Errorf("unknown option %s; use --help or describe what to read", name)
		}
	}
	if stdinRequest {
		if len(positional) > 0 || o.Input != "" {
			return o, errors.New("stdin request cannot be combined with another input or intent")
		}
		data, err := io.ReadAll(io.LimitReader(stdin, (1<<20)+1))
		if err != nil {
			return o, err
		}
		if len(data) > 1<<20 {
			return o, errors.New("request exceeds 1 MiB")
		}
		if strings.HasPrefix(strings.TrimSpace(string(data)), "{") {
			// A JSON request always gets a JSON response unless explicitly overridden.
			o.Format = "json"
			o.structured = true
			decoder := json.NewDecoder(strings.NewReader(string(data)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&o.Request); err != nil {
				return o, fmt.Errorf("invalid JSON request: %w", err)
			}
			if err := decoder.Decode(new(any)); err != io.EOF {
				return o, errors.New("expected exactly one JSON request")
			}
		} else {
			o.Intent = strings.TrimSpace(string(data))
			if o.Intent == "" {
				return o, errors.New("stdin request is empty")
			}
		}
	} else if len(positional) > 0 {
		o.Intent = strings.Join(positional, " ")
		// Separate shell arguments preserve paths with spaces without reparsing.
		for _, arg := range positional {
			if info, err := os.Stat(arg); err == nil && info.Mode().IsRegular() {
				if o.Input != "" && o.Input != arg {
					return o, errors.New("one file per request; multiple input paths found")
				}
				o.Input = arg
			}
		}
	}
	if explicitFormat != "" {
		o.Format = explicitFormat
	}
	if err := resolveIntent(&o.Request); err != nil {
		return o, err
	}
	if o.timeout <= 0 {
		return o, errors.New("timeout must be positive")
	}
	if o.MaxBytes < 0 || o.MaxBytes > converter.MaxContentBytes {
		return o, errors.New("maxBytes must be between 1 and 33554432, or 0 for the default")
	}
	return o, nil
}

func resolveIntent(r *Request) error {
	intent := strings.TrimSpace(r.Intent)
	lower := strings.ToLower(intent)
	intentOptions := quotedPath.ReplaceAllString(intent, "")
	if r.Input != "" {
		intentOptions = strings.ReplaceAll(intentOptions, r.Input, "")
	}
	r.Layout = r.Layout || r.Operation == "layout" || layoutIntent.MatchString(intentOptions)
	if r.Format == "" {
		switch {
		case outputIntent.MatchString(intentOptions):
			r.Format = outputIntent.FindStringSubmatch(intentOptions)[1]
		case outputSuffix.MatchString(intentOptions):
			r.Format = outputSuffix.FindStringSubmatch(intentOptions)[1]
		case jsonIntent.MatchString(intentOptions):
			r.Format = "json"
		case textIntent.MatchString(intent):
			r.Format = "text"
		case r.Layout:
			r.Format = "json"
		default:
			r.Format = "text"
		}
	}
	r.Format = normalizeFormat(r.Format)
	if !validFormat(r.Format) {
		return fmt.Errorf("unsupported output format %q; choose %s", r.Format, strings.Join(outputFormats, ", "))
	}
	if r.Layout && r.Format == "text" {
		return errors.New("plain text cannot represent layout metadata; choose json, yaml, xml, markdown, html, csv or tsv")
	}
	if r.Operation == "capacity" {
		r.Operation = "capabilities"
	}
	if r.Operation == "extract" {
		r.Operation = "read"
	}
	if r.Operation == "" {
		switch {
		case intent == "", lower == "capacity", lower == "capabilities", strings.HasPrefix(lower, "capacity "), strings.HasPrefix(lower, "capabilities "), hasAny(lower, "你能做什么", "有什么能力", "支持哪些", "what can you do", "your capabilities"):
			if r.Input == "" {
				r.Operation = "capabilities"
			} else {
				r.Operation = "read"
			}
		case hasAny(lower, "understand", "理解", "检查文档"):
			r.Operation = "understand"
		case r.Layout:
			r.Operation = "layout"
		default:
			r.Operation = "read"
		}
	}
	if r.Operation != "read" && r.Operation != "understand" && r.Operation != "capabilities" && r.Operation != "layout" {
		return fmt.Errorf("unsupported operation %q", r.Operation)
	}
	if r.Operation == "capabilities" {
		if r.Input != "" {
			return errors.New("capabilities does not accept an input file")
		}
		return nil
	}
	// Look for additional paths even when an existing shell argument or input
	// field already supplied one. Otherwise a missing second file gets ignored.
	search := intent
	if r.Input != "" {
		search = strings.ReplaceAll(search, r.Input, "")
	}
	for _, match := range quotedPath.FindAllStringSubmatch(search, -1) {
		if err := setInput(r, match[1]); err != nil {
			return err
		}
		search = strings.ReplaceAll(search, match[0], "")
	}
	for _, match := range barePath.FindAllString(search, -1) {
		for _, prefix := range []string{"读取", "提取", "理解", "读一下", "读"} {
			match = strings.TrimPrefix(match, prefix)
		}
		if err := setInput(r, match); err != nil {
			return err
		}
	}
	if r.Input == "" {
		return errors.New("name the local file to read, for example: filens '读取 " + `"report.pdf"` + "，以 JSON 输出'")
	}
	if strings.Contains(r.Input, "://") {
		return errors.New("input must be a local file path")
	}
	// The caller does semantic reasoning; never silently pass a question off as
	// a locally generated answer. File names do not participate in this check.
	remaining := strings.ReplaceAll(lower, strings.ToLower(r.Input), "")
	if hasAny(remaining, "summarize", "summarise", "总结", "摘要", "问答", "翻译", "translate", "回答", "how many", "多少", "为什么", "why ") {
		return errors.New("semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer")
	}
	return nil
}

func setInput(r *Request, value string) error {
	if r.Input != "" && r.Input != value {
		return errors.New("one file per request; multiple input paths found")
	}
	r.Input = value
	return nil
}

func hasAny(value string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(value, term) {
			return true
		}
	}
	return false
}
