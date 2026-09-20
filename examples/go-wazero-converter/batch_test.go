package converter

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadBatchManifest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, []byte(`{"defaults":{"targetFormat":"docx"},"jobs":[{"inputPath":"a.doc","outputPath":"b.docx"}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest, err := ReadBatchManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Jobs) != 1 {
		t.Fatalf("unexpected jobs length: %d", len(manifest.Jobs))
	}
	if manifest.Jobs[0].InputPath != "a.doc" || manifest.Jobs[0].OutputPath != "b.docx" {
		t.Fatalf("unexpected job: %+v", manifest.Jobs[0])
	}
	if manifest.Defaults.TargetFormat != "docx" {
		t.Fatalf("unexpected defaults: %+v", manifest.Defaults)
	}
}

func TestRunBatchWritesReport(t *testing.T) {
	tempDir := t.TempDir()
	inputA := filepath.Join(tempDir, "a.doc")
	inputB := filepath.Join(tempDir, "b.doc")
	outputA := filepath.Join(tempDir, "a.docx")
	outputB := filepath.Join(tempDir, "b.docx")
	if err := os.WriteFile(inputA, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inputB, []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := BatchManifest{
		Defaults: BatchDefaults{
			SourceFormat: "doc",
			TargetFormat: "docx",
			Locale:       "en-US",
		},
		Jobs: []BatchJob{
			{InputPath: inputA, OutputPath: outputA},
			{InputPath: inputB, OutputPath: outputB, Locale: "zh-CN"},
		},
	}

	var stdout bytes.Buffer
	call := 0
	report, err := RunBatch(context.Background(), BatchConfig{
		WasmPath: "converter-core.wasm",
		Manifest: manifest,
		Stdout:   &stdout,
	})
	if err == nil {
		t.Fatal("expected RunBatch to use default converter and fail without a real wasm file in this test")
	}

	stdout.Reset()
	report, err = RunBatch(context.Background(), BatchConfig{
		WasmPath:   "converter-core.wasm",
		Manifest:   manifest,
		ReportPath: "-",
		Stdout:     &stdout,
		Convert: func(
			_ context.Context,
			_ string,
			_ string,
			outputPath string,
			sourceFormat string,
			targetFormat string,
			options Options,
		) (Result, error) {
			call++
			if sourceFormat != "doc" || targetFormat != "docx" {
				t.Fatalf("unexpected formats: %s -> %s", sourceFormat, targetFormat)
			}
			if call == 1 && options.Locale != "en-US" {
				t.Fatalf("unexpected default locale: %+v", options)
			}
			if call == 2 && options.Locale != "zh-CN" {
				t.Fatalf("unexpected job locale override: %+v", options)
			}
			if err := os.WriteFile(outputPath, []byte("converted"), 0o644); err != nil {
				t.Fatal(err)
			}
			return Result{
				OK:           call == 1,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				Backend:      "mock",
				Fidelity:     ConversionFidelityLightweight,
				ErrorCode:    map[bool]string{true: "", false: ErrorCodeEngineUnavailable}[call == 1],
			}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.OK {
		t.Fatal("expected mixed batch result to be false")
	}
	if len(report.Results) != 2 {
		t.Fatalf("unexpected result count: %d", len(report.Results))
	}
	if report.Summary.Total != 2 || report.Summary.OK != 1 || report.Summary.Failed != 1 {
		t.Fatalf("unexpected summary: %+v", report.Summary)
	}
	if report.Summary.ByBackend["mock"] != 2 {
		t.Fatalf("unexpected backend summary: %+v", report.Summary.ByBackend)
	}
	if report.Summary.ByFidelity[ConversionFidelityLightweight] != 2 {
		t.Fatalf("unexpected fidelity summary: %+v", report.Summary.ByFidelity)
	}
	if report.Summary.ByErrorCode[ErrorCodeEngineUnavailable] != 1 {
		t.Fatalf("unexpected error summary: %+v", report.Summary.ByErrorCode)
	}
	if stdout.Len() == 0 {
		t.Fatal("expected stdout report")
	}
	var decoded BatchReport
	if err := json.Unmarshal(stdout.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Results) != 2 {
		t.Fatalf("unexpected decoded results: %d", len(decoded.Results))
	}
}

func TestRunBatchCanWriteReportFile(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "a.doc")
	outputPath := filepath.Join(tempDir, "a.docx")
	reportPath := filepath.Join(tempDir, "reports", "batch.json")
	if err := os.WriteFile(inputPath, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := BatchManifest{
		Defaults: BatchDefaults{
			SourceFormat: "doc",
			TargetFormat: "docx",
		},
		Jobs: []BatchJob{
			{InputPath: inputPath, OutputPath: outputPath},
		},
	}

	report, err := RunBatch(context.Background(), BatchConfig{
		WasmPath:   "converter-core.wasm",
		Manifest:   manifest,
		ReportPath: reportPath,
		Convert: func(_ context.Context, _ string, _ string, output string, source string, target string, _ Options) (Result, error) {
			if err := os.WriteFile(output, []byte("converted"), 0o644); err != nil {
				t.Fatal(err)
			}
			return Result{OK: true, SourceFormat: source, TargetFormat: target}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK {
		t.Fatal("expected ok report")
	}
	bytes, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	var decoded BatchReport
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.OK || len(decoded.Results) != 1 {
		t.Fatalf("unexpected decoded report: %+v", decoded)
	}
	if decoded.Summary.Total != 1 || decoded.Summary.OK != 1 || decoded.Summary.Failed != 0 {
		t.Fatalf("unexpected decoded summary: %+v", decoded.Summary)
	}
}

func TestFixtureManifestSmoke(t *testing.T) {
	manifestPath := filepath.Join("fixtures", "manifest.json")
	manifest, err := ReadBatchManifest(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Jobs) == 0 {
		t.Fatal("expected fixture manifest to contain jobs")
	}

	seenPairs := map[string]bool{}
	for _, job := range manifest.Jobs {
		sourceFormat := strings.ToLower(job.SourceFormat)
		targetFormat := strings.ToLower(job.TargetFormat)
		if !isSupportedConversionPair(sourceFormat, targetFormat) {
			t.Fatalf("unexpected conversion pair in fixture manifest: %s -> %s", sourceFormat, targetFormat)
		}
		seenPairs[sourceFormat+"->"+targetFormat] = true
	}
	for _, pair := range SupportedConversions() {
		if !seenPairs[pair.SourceFormat+"->"+pair.TargetFormat] {
			t.Fatalf("fixture manifest is missing a sample for %s -> %s", pair.SourceFormat, pair.TargetFormat)
		}
	}

	tempDir := t.TempDir()
	for index := range manifest.Jobs {
		if !strings.HasPrefix(manifest.Jobs[index].OutputPath, "./tmp/") {
			t.Fatalf("unexpected fixture output path: %s", manifest.Jobs[index].OutputPath)
		}
		manifest.Jobs[index].OutputPath = filepath.Join(tempDir, filepath.Base(manifest.Jobs[index].OutputPath))
	}

	callCount := 0
	report, err := RunBatch(context.Background(), BatchConfig{
		WasmPath: "converter-core.wasm",
		Manifest: manifest,
		Convert: func(
			_ context.Context,
			_ string,
			inputPath string,
			outputPath string,
			sourceFormat string,
			targetFormat string,
			_ Options,
		) (Result, error) {
			callCount++
			if _, err := os.Stat(inputPath); err != nil {
				t.Fatalf("fixture input missing: %s (%v)", inputPath, err)
			}
			if !isSupportedConversionPair(sourceFormat, targetFormat) {
				t.Fatalf("unexpected conversion pair in fixture manifest: %s -> %s", sourceFormat, targetFormat)
			}
			if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(outputPath, []byte("fixture smoke marker"), 0o644); err != nil {
				t.Fatal(err)
			}
			return Result{
				OK:           false,
				SourceFormat: sourceFormat,
				TargetFormat: targetFormat,
				ErrorCode:    ErrorCodeEngineUnavailable,
				ErrorMessage: "fixture smoke test forced failure",
			}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.OK {
		t.Fatal("expected fixture smoke report to be non-ok because the injected converter returns engine_unavailable")
	}
	if callCount != len(manifest.Jobs) {
		t.Fatalf("expected %d fixture jobs, got %d", len(manifest.Jobs), callCount)
	}
	if report.Summary.Total != len(manifest.Jobs) || report.Summary.Failed != len(manifest.Jobs) {
		t.Fatalf("unexpected fixture smoke summary: %+v", report.Summary)
	}
	for _, item := range report.Results {
		if item.Result.ErrorCode != ErrorCodeEngineUnavailable {
			t.Fatalf("unexpected fixture result code: %+v", item.Result)
		}
	}
}

func TestRunBatchUsesWASIConverterForFullManifest(t *testing.T) {
	exampleRoot := filepath.Join(findRepoRoot(t), "examples", "go-wazero-converter")
	manifest, err := ReadBatchManifest(filepath.Join(exampleRoot, "fixtures", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}

	tempDir := t.TempDir()
	for index := range manifest.Jobs {
		manifest.Jobs[index].InputPath = filepath.Join(exampleRoot, fixtureRelativePath(manifest.Jobs[index].InputPath))
		manifest.Jobs[index].OutputPath = filepath.Join(tempDir, filepath.Base(manifest.Jobs[index].OutputPath))
	}

	report, err := RunBatch(context.Background(), BatchConfig{
		WasmPath: buildConverterCoreWASM(t),
		Manifest: manifest,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK {
		t.Fatalf("expected WASM manifest conversion to be ok: %+v", report.Summary)
	}
	if report.Summary.Total != len(manifest.Jobs) || report.Summary.OK != len(manifest.Jobs) || report.Summary.Failed != 0 {
		t.Fatalf("unexpected WASM manifest summary: %+v", report.Summary)
	}
	if report.Summary.ByBackend["wasi"] != len(manifest.Jobs) {
		t.Fatalf("unexpected WASI backend summary: %+v", report.Summary.ByBackend)
	}
	expectedFidelityCounts := map[string]int{}
	for _, job := range manifest.Jobs {
		expectedFidelityCounts[expectedFixtureFidelity(job.SourceFormat)]++
	}
	if report.Summary.ByFidelity[ConversionFidelityLightweight] != expectedFidelityCounts[ConversionFidelityLightweight] {
		t.Fatalf("unexpected WASM fidelity summary: %+v", report.Summary.ByFidelity)
	}
	for _, item := range report.Results {
		if item.Result.Backend != "wasi" || item.Result.Fidelity != expectedFixtureFidelity(item.Job.SourceFormat) {
			t.Fatalf("unexpected WASM result metadata: %+v", item.Result)
		}
		if _, err := os.Stat(item.Job.OutputPath); err != nil {
			t.Fatalf("expected WASM output %s: %v", item.Job.OutputPath, err)
		}
		if err := ValidateOpenXMLOutput(item.Job.OutputPath, item.Job.TargetFormat); err != nil {
			t.Fatalf("expected valid OpenXML output for %s: %v", item.Job.OutputPath, err)
		}
		assertWASMFixtureContent(t, item.Job, item.Result)
	}
}

func fixtureRelativePath(path string) string {
	path = strings.TrimPrefix(path, "./")
	path = strings.TrimPrefix(path, ".\\")
	return filepath.FromSlash(path)
}

func expectedFixtureFidelity(sourceFormat string) string {
	return ConversionFidelityLightweight
}

type fixtureContentExpectation struct {
	entry    string
	contains []string
}

func assertWASMFixtureContent(t *testing.T, job BatchJob, result Result) {
	t.Helper()
	expectation, ok := fixtureContentExpectations()[fixtureKey(job.InputPath)]
	if !ok {
		return
	}
	for _, warning := range result.Warnings {
		if strings.Contains(warning, "No readable") {
			t.Fatalf("content-bearing fixture reported empty content for %s: %+v", job.InputPath, result.Warnings)
		}
	}
	xml := readOpenXMLFixtureEntry(t, job.OutputPath, expectation.entry)
	for _, expected := range expectation.contains {
		if !strings.Contains(xml, expected) {
			t.Fatalf("fixture output %s:%s is missing %q: %s", job.OutputPath, expectation.entry, expected, xml)
		}
	}
}

func fixtureContentExpectations() map[string]fixtureContentExpectation {
	expectations := map[string]fixtureContentExpectation{
		"./fixtures/doc/sample.doc": {
			entry:    "word/document.xml",
			contains: []string{"Fixture DOC legacy document", "WASM core extracts DOC text"},
		},
		"./fixtures/doc/sample.dot": {
			entry:    "word/document.xml",
			contains: []string{"Fixture DOT legacy template", "WASM core extracts DOT text"},
		},
		"./fixtures/doc/sample.dotx": {
			entry:    "word/document.xml",
			contains: []string{"Fixture DOTX template document"},
		},
		"./fixtures/doc/sample.wps": {
			entry:    "word/document.xml",
			contains: []string{"Fixture WPS legacy document", "WASM core extracts WPS text"},
		},
		"./fixtures/doc/sample.wpt": {
			entry:    "word/document.xml",
			contains: []string{"Fixture WPT legacy template", "WASM core extracts WPT text"},
		},
		"./fixtures/doc/sample.rtf": {
			entry:    "word/document.xml",
			contains: []string{"Fixture RTF document for legacy conversion smoke testing.", "simple number: 42."},
		},
		"./fixtures/doc/sample.odt": {
			entry:    "word/document.xml",
			contains: []string{"Fixture OpenDocument text sample for conversion smoke testing.", "Route target: docx."},
		},
		"./fixtures/doc/sample.ott": {
			entry:    "word/document.xml",
			contains: []string{"Fixture OpenDocument text sample for conversion smoke testing.", "Route target: docx."},
		},
		"./fixtures/doc/sample.fodt": {
			entry:    "word/document.xml",
			contains: []string{"Fixture Flat OpenDocument text sample for conversion smoke testing.", "Route target: docx."},
		},
		"./fixtures/doc/sample.txt": {
			entry:    "word/document.xml",
			contains: []string{"Fixture TXT document", "This controlled UTF-8 fixture exercises txt"},
		},
		"./fixtures/doc/sample.md": {
			entry:    "word/document.xml",
			contains: []string{"Fixture Markdown document", "Markdown list item", "Name / Value", "Fixture table / 42"},
		},
		"./fixtures/doc/sample.mkd": {
			entry:    "word/document.xml",
			contains: []string{"Fixture Markdown document", "Markdown list item", "Name / Value", "Fixture table / 42"},
		},
		"./fixtures/doc/sample.html": {
			entry:    "word/document.xml",
			contains: []string{"Fixture HTML document", "HTML extractor smoke"},
		},
		"./fixtures/doc/sample.xht": {
			entry:    "word/document.xml",
			contains: []string{"Fixture HTML document", "HTML extractor smoke"},
		},
		"./fixtures/doc/sample.epub": {
			entry:    "word/document.xml",
			contains: []string{"Fixture EPUB chapter one", "First EPUB body paragraph.", "Fixture EPUB chapter two", "Second EPUB body paragraph."},
		},
		"./fixtures/doc/sample.fb2": {
			entry:    "word/document.xml",
			contains: []string{"Fixture FB2 chapter one", "First FB2 body paragraph.", "Fixture FB2 chapter two", "Second FB2 body paragraph."},
		},
		"./fixtures/doc/sample.xml": {
			entry:    "word/document.xml",
			contains: []string{"Fixture XML document", "XML parser smoke text."},
		},
		"./fixtures/doc/sample.rss": {
			entry:    "word/document.xml",
			contains: []string{"Fixture RSS feed", "Fixture RSS item"},
		},
		"./fixtures/doc/sample.atom": {
			entry:    "word/document.xml",
			contains: []string{"Fixture Atom feed", "Fixture Atom entry"},
		},
		"./fixtures/doc/sample.kml": {
			entry:    "word/document.xml",
			contains: []string{"Fixture KML place", "KML parser smoke text."},
		},
		"./fixtures/doc/sample.gpx": {
			entry:    "word/document.xml",
			contains: []string{"Fixture GPX track", "Fixture GPX waypoint"},
		},
		"./fixtures/doc/sample.ttml": {
			entry:    "word/document.xml",
			contains: []string{"Fixture TTML subtitle text."},
		},
		"./fixtures/doc/sample.dfxp": {
			entry:    "word/document.xml",
			contains: []string{"Fixture DFXP subtitle text."},
		},
		"./fixtures/doc/sample.xsd": {
			entry:    "word/document.xml",
			contains: []string{"Fixture XSD schema documentation."},
		},
		"./fixtures/doc/sample.xsl": {
			entry:    "word/document.xml",
			contains: []string{"Fixture XSLT stylesheet output"},
		},
		"./fixtures/doc/sample.xslt": {
			entry:    "word/document.xml",
			contains: []string{"Fixture XSLT stylesheet output"},
		},
		"./fixtures/doc/sample.wsdl": {
			entry:    "word/document.xml",
			contains: []string{"Fixture WSDL service documentation."},
		},
		"./fixtures/doc/sample.plist": {
			entry:    "word/document.xml",
			contains: []string{"FixtureName", "Fixture plist value"},
		},
		"./fixtures/doc/sample.pom": {
			entry:    "word/document.xml",
			contains: []string{"test.fixture", "fixture-pom-artifact"},
		},
		"./fixtures/doc/sample.cfg": {
			entry:    "word/document.xml",
			contains: []string{"Fixture CFG document", "This controlled UTF-8 fixture exercises cfg"},
		},
		"./fixtures/doc/sample.rest": {
			entry:    "word/document.xml",
			contains: []string{"Fixture REST document", "This controlled UTF-8 fixture exercises rest"},
		},
		"./fixtures/doc/sample.cxx": {
			entry:    "word/document.xml",
			contains: []string{"Fixture CXX document", "This controlled UTF-8 fixture exercises cxx"},
		},
		"./fixtures/doc/sample.csproj": {
			entry:    "word/document.xml",
			contains: []string{"Fixture CSPROJ document", "This controlled UTF-8 fixture exercises csproj"},
		},
		"./fixtures/doc/sample.haml": {
			entry:    "word/document.xml",
			contains: []string{"Fixture HAML document", "This controlled UTF-8 fixture exercises haml"},
		},
		"./fixtures/doc/sample.eml": {
			entry:    "word/document.xml",
			contains: []string{"Subject: Fixture EML message", "Fixture EML message body"},
		},
		"./fixtures/doc/sample.mbox": {
			entry:    "word/document.xml",
			contains: []string{"Message 1", "Subject: Fixture MBOX first message", "Fixture MBOX first body", "Message 2", "Subject: Fixture MBOX second message", "Fixture MBOX second body"},
		},
		"./fixtures/doc/sample.msg": {
			entry:    "word/document.xml",
			contains: []string{"Subject: Fixture MSG subject", "From: Fixture MSG sender", "Fixture MSG body for converter smoke.", "Second MSG body line."},
		},
		"./fixtures/doc/sample.oft": {
			entry:    "word/document.xml",
			contains: []string{"Subject: Fixture OFT subject", "From: Fixture OFT sender", "Fixture OFT body for converter smoke.", "Second OFT body line."},
		},
		"./fixtures/doc/sample.gitmodules": {
			entry:    "word/document.xml",
			contains: []string{"vendor/fixture", "https://example.test/vendor/fixture.git"},
		},
		"./fixtures/doc/sample.ass": {
			entry:    "word/document.xml",
			contains: []string{"Fixture ASS subtitle second line, comma kept"},
		},
		"./fixtures/doc/sample.ssa": {
			entry:    "word/document.xml",
			contains: []string{"Fixture SSA subtitle with comma, preserved"},
		},
		"./fixtures/doc/sample.sbv": {
			entry:    "word/document.xml",
			contains: []string{"Fixture SBV subtitle line one. Fixture SBV subtitle line two.", "Second SBV cue."},
		},
		"./fixtures/xls/sample.xls": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture XLS spreadsheet", "42.5"},
		},
		"./fixtures/xls/sample.et": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture ET spreadsheet", "43.5"},
		},
		"./fixtures/xls/sample.ett": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture ETT template", "45.5"},
		},
		"./fixtures/xls/sample.xlt": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture XLT template", "44.5"},
		},
		"./fixtures/xls/sample.xltx": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture XLTX template workbook", "65.5"},
		},
		"./fixtures/xls/sample.ods": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Name", "42"},
		},
		"./fixtures/xls/sample.ots": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Name", "42"},
		},
		"./fixtures/xls/sample.fods": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Flat Name", "72"},
		},
		"./fixtures/xls/sample.dbf": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture DBF caf\u00e9 \u2013 row", "70.5", "2026-06-14", `t="b"><v>1</v>`},
		},
		"./fixtures/xls/sample.slk": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture SYLK row", "68.5"},
		},
		"./fixtures/xls/sample.dif": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture DIF row", "69.5"},
		},
		"./fixtures/xls/sample.csv": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture CSV UTF16 semicolon row", "56.5"},
		},
		"./fixtures/xls/sample.tsv": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture TSV row", "57.5"},
		},
		"./fixtures/xls/sample.tab": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture TAB row", "57.75"},
		},
		"./fixtures/xls/sample.psv": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture PSV row", "58.5"},
		},
		"./fixtures/xls/sample.json": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture JSON row", "Second JSON row"},
		},
		"./fixtures/xls/sample.jsonl": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture JSONL row", "Second JSONL row"},
		},
		"./fixtures/xls/sample.ndjson": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture NDJSON row", "Second NDJSON row"},
		},
		"./fixtures/xls/sample.jsonlines": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture JSONLINES row", "Second JSONLINES row"},
		},
		"./fixtures/xls/sample.ldjson": {
			entry:    "xl/worksheets/sheet1.xml",
			contains: []string{"Fixture LDJSON row", "Second LDJSON row"},
		},
		"./fixtures/ppt/sample.ppt": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture PPT deck title", "Fixture PPT bullet"},
		},
		"./fixtures/ppt/sample.dps": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture DPS deck title", "Fixture DPS bullet"},
		},
		"./fixtures/ppt/sample.dpt": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture DPT template title", "Fixture DPT bullet"},
		},
		"./fixtures/ppt/sample.pps": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture PPS deck title", "Fixture PPS bullet"},
		},
		"./fixtures/ppt/sample.pot": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture POT deck title", "Fixture POT bullet"},
		},
		"./fixtures/ppt/sample.ppsx": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture PPSX slideshow slide"},
		},
		"./fixtures/ppt/sample.potx": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture POTX template slide"},
		},
		"./fixtures/ppt/sample.odp": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture OpenDocument presentation sample"},
		},
		"./fixtures/ppt/sample.otp": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture OpenDocument presentation sample"},
		},
		"./fixtures/ppt/sample.fodp": {
			entry:    "ppt/slides/slide1.xml",
			contains: []string{"Fixture Flat OpenDocument presentation sample"},
		},
	}
	return expectations
}
func fixtureKey(inputPath string) string {
	normalized := filepath.ToSlash(inputPath)
	if index := strings.LastIndex(normalized, "fixtures/"); index >= 0 {
		return "./" + normalized[index:]
	}
	if strings.HasPrefix(normalized, "./") {
		return normalized
	}
	return "./" + strings.TrimPrefix(normalized, "/")
}

func readOpenXMLFixtureEntry(t *testing.T, path string, entryName string) string {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, file := range reader.File {
		if file.Name != entryName {
			continue
		}
		content, err := readZipTextEntry(file)
		if err != nil {
			t.Fatal(err)
		}
		return content
	}
	t.Fatalf("zip entry %s not found in %s", entryName, path)
	return ""
}
