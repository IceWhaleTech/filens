package converter

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateOpenXMLOutputAcceptsMinimalArchives(t *testing.T) {
	cases := []struct {
		targetFormat string
	}{
		{targetFormat: "docx"},
		{targetFormat: "xlsx"},
		{targetFormat: "pptx"},
	}

	for _, testCase := range cases {
		t.Run(testCase.targetFormat, func(t *testing.T) {
			outputPath := filepath.Join(t.TempDir(), "out."+testCase.targetFormat)
			writeMinimalOpenXMLForValidation(t, outputPath, testCase.targetFormat)
			if err := ValidateOpenXMLOutput(outputPath, testCase.targetFormat); err != nil {
				t.Fatalf("expected valid OpenXML output: %v", err)
			}
		})
	}
}

func TestValidateOpenXMLOutputRejectsInvalidZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.docx")
	if err := os.WriteFile(path, []byte("not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ValidateOpenXMLOutput(path, "docx"); err == nil {
		t.Fatal("expected invalid zip to fail OpenXML validation")
	}
}

func TestValidateOpenXMLOutputRequiresTargetMainPartOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mismatched.docx")
	entries := minimalOpenXMLValidationEntries("docx")
	entries["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	writeOpenXMLValidationArchive(t, path, entries)

	err := ValidateOpenXMLOutput(path, "docx")
	if err == nil || !strings.Contains(err.Error(), "for /word/document.xml") {
		t.Fatalf("expected target main part content type validation error, got %v", err)
	}
}

func TestValidateOpenXMLOutputRejectsMacroEnabledOutputs(t *testing.T) {
	cases := []struct {
		name    string
		entries func() map[string]string
	}{
		{
			name: "macro content type",
			entries: func() map[string]string {
				entries := minimalOpenXMLValidationEntries("docx")
				entries["[Content_Types].xml"] = strings.Replace(
					entries["[Content_Types].xml"],
					requiredOpenXMLContentType("docx"),
					"application/vnd.ms-word.document.macroEnabled.main+xml",
					1,
				)
				return entries
			},
		},
		{
			name: "vba project part",
			entries: func() map[string]string {
				entries := minimalOpenXMLValidationEntries("docx")
				entries["word/vbaProject.bin"] = "macro bytes"
				return entries
			},
		},
		{
			name: "vba data part",
			entries: func() map[string]string {
				entries := minimalOpenXMLValidationEntries("docx")
				entries["word/vbaData.xml"] = "macro metadata"
				return entries
			},
		},
		{
			name: "vba relationship part",
			entries: func() map[string]string {
				entries := minimalOpenXMLValidationEntries("docx")
				entries["word/_rels/vbaProject.bin.rels"] = "macro relationships"
				return entries
			},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "macro.docx")
			writeOpenXMLValidationArchive(t, path, testCase.entries())

			err := ValidateOpenXMLOutput(path, "docx")
			if err == nil || !strings.Contains(strings.ToLower(err.Error()), "macro") {
				t.Fatalf("expected macro rejection, got %v", err)
			}
		})
	}
}

func writeMinimalOpenXMLForValidation(t *testing.T, path string, targetFormat string) {
	t.Helper()
	writeOpenXMLValidationArchive(t, path, minimalOpenXMLValidationEntries(targetFormat))
}

func writeOpenXMLValidationArchive(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	archive := zip.NewWriter(file)
	defer archive.Close()
	for name, content := range entries {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
}

func minimalOpenXMLValidationEntries(targetFormat string) map[string]string {
	return map[string]string{
		"[Content_Types].xml":                `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/` + minimalOpenXMLMainPart(targetFormat) + `" ContentType="` + requiredOpenXMLContentType(targetFormat) + `"/></Types>`,
		"_rels/.rels":                        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
		minimalOpenXMLMainPart(targetFormat): `<?xml version="1.0" encoding="UTF-8"?>`,
	}
}

func minimalOpenXMLMainPart(targetFormat string) string {
	switch normalizeFormat(targetFormat) {
	case "docx":
		return "word/document.xml"
	case "xlsx":
		return "xl/workbook.xml"
	case "pptx":
		return "ppt/presentation.xml"
	default:
		return "document.xml"
	}
}
