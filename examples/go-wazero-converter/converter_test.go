package converter

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestConvertUsesWASIConverterCore(t *testing.T) {
	wasmPath := buildConverterCoreWASM(t)

	inputPath := filepath.Join(findRepoRoot(t), "examples", "go-wazero-converter", "fixtures", "doc", "sample.doc")
	outputPath := filepath.Join(t.TempDir(), "out.docx")

	res, err := Convert(context.Background(), wasmPath, inputPath, outputPath, Options{Locale: "en-US"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK {
		t.Fatalf("expected WASM conversion to succeed: %+v", res)
	}
	if res.SourceFormat != "doc" || res.TargetFormat != "docx" {
		t.Fatalf("unexpected formats: %s -> %s", res.SourceFormat, res.TargetFormat)
	}
	if res.Backend != "wasi" || res.Fidelity != ConversionFidelityLightweight {
		t.Fatalf("expected WASM lightweight metadata, got %+v", res)
	}
	if res.Metrics.InputSize == 0 {
		t.Fatal("expected input size metric")
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("expected output copy on successful conversion, stat err=%v", err)
	}
	if err := ValidateOpenXMLOutput(outputPath, res.TargetFormat); err != nil {
		t.Fatalf("expected valid OpenXML output: %v", err)
	}
}

func TestConvertRejectsUnsupportedPairs(t *testing.T) {
	wasmPath := filepath.Join(t.TempDir(), "missing-converter-core.wasm")

	cases := []struct {
		name         string
		sourceFormat string
		targetFormat string
	}{
		{name: "image", sourceFormat: "webp", targetFormat: "png"},
		{name: "iwork spreadsheet", sourceFormat: "numbers", targetFormat: "xlsx"},
		{name: "binary workbook", sourceFormat: "xlsb", targetFormat: "xlsx"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			inputPath := filepath.Join(t.TempDir(), "input."+testCase.sourceFormat)
			outputPath := filepath.Join(t.TempDir(), "output."+testCase.targetFormat)
			if err := os.WriteFile(inputPath, []byte("not an allowed conversion"), 0o644); err != nil {
				t.Fatal(err)
			}

			res, err := Convert(context.Background(), wasmPath, inputPath, outputPath, Options{})
			if err != nil {
				t.Fatal(err)
			}
			if res.ErrorCode != ErrorCodeUnsupportedFormat {
				t.Fatalf("expected unsupported_format, got %q", res.ErrorCode)
			}
			if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
				t.Fatalf("unsupported conversion should not create output, stat err=%v", err)
			}
		})
	}
}

func TestConvertWithFormatsValidatesRequiredFormatsBeforeReadingWASM(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "input.doc")
	outputPath := filepath.Join(tempDir, "output.docx")
	if err := os.WriteFile(inputPath, []byte("input"), 0o644); err != nil {
		t.Fatal(err)
	}

	testCases := []struct {
		name         string
		sourceFormat string
		targetFormat string
		want         string
	}{
		{name: "missing source", sourceFormat: "", targetFormat: "docx", want: "source format is required"},
		{name: "missing target", sourceFormat: "doc", targetFormat: "", want: "target format is required"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := ConvertWithFormats(
				context.Background(),
				filepath.Join(tempDir, "does-not-exist.wasm"),
				inputPath,
				outputPath,
				testCase.sourceFormat,
				testCase.targetFormat,
				Options{},
			)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected %q validation error before WASM execution, got %v", testCase.want, err)
			}
			if strings.Contains(err.Error(), "wasm") {
				t.Fatalf("format validation should run before WASM loading, got %v", err)
			}
		})
	}
}

func TestConvertRejectsUnsupportedPairsBeforeReadingWASM(t *testing.T) {
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "image.webp")
	outputPath := filepath.Join(tempDir, "image.png")
	if err := os.WriteFile(inputPath, []byte("image bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := ConvertWithFormats(
		context.Background(),
		filepath.Join(tempDir, "does-not-exist.wasm"),
		inputPath,
		outputPath,
		".WEBP",
		" PNG ",
		Options{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.OK || result.ErrorCode != ErrorCodeUnsupportedFormat {
		t.Fatalf("expected unsupported_format before WASM execution, got %+v", result)
	}
	if result.SourceFormat != "webp" || result.TargetFormat != "png" {
		t.Fatalf("expected normalized formats, got %+v", result)
	}
}

func TestConvertReturnsStableWASIErrorCodes(t *testing.T) {
	wasmPath := buildConverterCoreWASM(t)

	testCases := []struct {
		name      string
		inputName string
		writeFile func(t *testing.T, path string)
		options   Options
		wantCode  string
	}{
		{
			name:      "corrupt legacy word",
			inputName: "corrupt.doc",
			writeFile: func(t *testing.T, path string) {
				t.Helper()
				if err := os.WriteFile(path, []byte("this is not a compound Word document"), 0o644); err != nil {
					t.Fatal(err)
				}
			},
			wantCode: ErrorCodeParse,
		},
		{
			name:      "encrypted legacy word without password",
			inputName: "encrypted.doc",
			writeFile: func(t *testing.T, path string) {
				t.Helper()
				if err := os.WriteFile(path, readEncryptedDocumentForTest(t), 0o644); err != nil {
					t.Fatal(err)
				}
			},
			wantCode: ErrorCodePasswordRequired,
		},
		{
			name:      "encrypted legacy word with password",
			inputName: "encrypted.doc",
			writeFile: func(t *testing.T, path string) {
				t.Helper()
				if err := os.WriteFile(path, readEncryptedDocumentForTest(t), 0o644); err != nil {
					t.Fatal(err)
				}
			},
			options:  Options{Password: "secret"},
			wantCode: ErrorCodePasswordInvalid,
		},
		{
			name:      "damaged encrypted document with password",
			inputName: "damaged.doc",
			writeFile: func(t *testing.T, path string) {
				t.Helper()
				if err := os.WriteFile(path, buildEncryptedCompoundFileForTest(), 0o644); err != nil {
					t.Fatal(err)
				}
			},
			options:  Options{Password: "secret"},
			wantCode: ErrorCodeParse,
		},
		{
			name:      "oversized legacy word",
			inputName: "large.doc",
			writeFile: func(t *testing.T, path string) {
				t.Helper()
				file, err := os.Create(path)
				if err != nil {
					t.Fatal(err)
				}
				if err := file.Truncate((64 << 20) + 1); err != nil {
					_ = file.Close()
					t.Fatal(err)
				}
				if err := file.Close(); err != nil {
					t.Fatal(err)
				}
			},
			wantCode: ErrorCodeIO,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			tempDir := t.TempDir()
			inputPath := filepath.Join(tempDir, testCase.inputName)
			outputPath := filepath.Join(tempDir, "out.docx")
			testCase.writeFile(t, inputPath)

			res, err := Convert(context.Background(), wasmPath, inputPath, outputPath, testCase.options)
			if err != nil {
				t.Fatal(err)
			}
			if res.OK {
				t.Fatalf("expected conversion failure, got %+v", res)
			}
			if res.ErrorCode != testCase.wantCode {
				t.Fatalf("unexpected error code: got %q want %q result=%+v", res.ErrorCode, testCase.wantCode, res)
			}
			if res.SourceFormat != "doc" || res.TargetFormat != "docx" {
				t.Fatalf("unexpected formats in error result: %+v", res)
			}
		})
	}
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve caller")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func buildEncryptedCompoundFileForTest() []byte {
	return buildCompoundFileForTest("EncryptionInfo", "EncryptedPackage")
}

func readEncryptedDocumentForTest(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(findRepoRoot(t), "packages", "converter-client", "test", "fixtures", "password", "reference", "rc4cryptoapi_password.doc"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func buildCompoundFileForTest(streamNames ...string) []byte {
	const sectorSize = 512
	const directorySector = 0
	const fatSector = 1
	const firstStreamSector = 2
	const freeSector = 0xffffffff
	const endOfChain = 0xfffffffe
	const fatSectorMarker = 0xfffffffd
	const directoryStream = 2
	const directoryRoot = 5

	sectorCount := firstStreamSector + len(streamNames)
	bytes := make([]byte, 512+sectorCount*sectorSize)
	copy(bytes, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	binary.LittleEndian.PutUint16(bytes[0x18:0x1A], 0x003E)
	binary.LittleEndian.PutUint16(bytes[0x1A:0x1C], 3)
	binary.LittleEndian.PutUint16(bytes[0x1C:0x1E], 0xFFFE)
	binary.LittleEndian.PutUint16(bytes[0x1E:0x20], 9)
	binary.LittleEndian.PutUint16(bytes[0x20:0x22], 6)
	binary.LittleEndian.PutUint32(bytes[0x2C:0x30], 1)
	binary.LittleEndian.PutUint32(bytes[0x30:0x34], directorySector)
	binary.LittleEndian.PutUint32(bytes[0x38:0x3C], 4096)
	binary.LittleEndian.PutUint32(bytes[0x3C:0x40], endOfChain)
	binary.LittleEndian.PutUint32(bytes[0x44:0x48], endOfChain)
	binary.LittleEndian.PutUint32(bytes[0x4C:0x50], fatSector)
	for offset := 0x50; offset+4 <= 0x200; offset += 4 {
		binary.LittleEndian.PutUint32(bytes[offset:offset+4], freeSector)
	}

	directoryOffset := 512 + directorySector*sectorSize
	writeCompoundDirectoryEntryForTest(bytes[directoryOffset:], 0, "Root Entry", directoryRoot, endOfChain, 0)
	for index, streamName := range streamNames {
		writeCompoundDirectoryEntryForTest(
			bytes[directoryOffset:],
			index+1,
			streamName,
			directoryStream,
			uint32(firstStreamSector+index),
			16,
		)
	}

	fatOffset := 512 + fatSector*sectorSize
	for offset := 0; offset < sectorSize; offset += 4 {
		binary.LittleEndian.PutUint32(bytes[fatOffset+offset:fatOffset+offset+4], freeSector)
	}
	binary.LittleEndian.PutUint32(bytes[fatOffset+directorySector*4:fatOffset+directorySector*4+4], endOfChain)
	binary.LittleEndian.PutUint32(bytes[fatOffset+fatSector*4:fatOffset+fatSector*4+4], fatSectorMarker)
	for index := range streamNames {
		sector := firstStreamSector + index
		binary.LittleEndian.PutUint32(bytes[fatOffset+sector*4:fatOffset+sector*4+4], endOfChain)
	}
	return bytes
}

func writeCompoundDirectoryEntryForTest(directory []byte, index int, name string, entryType byte, startSector uint32, size uint64) {
	record := directory[index*128 : index*128+128]
	units := utf16.Encode([]rune(name))
	for unitIndex, unit := range units {
		binary.LittleEndian.PutUint16(record[unitIndex*2:unitIndex*2+2], unit)
	}
	binary.LittleEndian.PutUint16(record[len(units)*2:len(units)*2+2], 0)
	binary.LittleEndian.PutUint16(record[0x40:0x42], uint16((len(units)+1)*2))
	record[0x42] = entryType
	record[0x43] = 1
	binary.LittleEndian.PutUint32(record[0x44:0x48], 0xffffffff)
	binary.LittleEndian.PutUint32(record[0x48:0x4C], 0xffffffff)
	binary.LittleEndian.PutUint32(record[0x4C:0x50], 0xffffffff)
	binary.LittleEndian.PutUint32(record[0x74:0x78], startSector)
	binary.LittleEndian.PutUint32(record[0x78:0x7C], uint32(size))
	binary.LittleEndian.PutUint32(record[0x7C:0x80], uint32(size>>32))
}
