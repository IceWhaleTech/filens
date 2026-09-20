package converter

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

func ValidateOpenXMLOutput(path string, targetFormat string) error {
	format := normalizeFormat(targetFormat)
	requiredEntries := requiredOpenXMLEntries(format)
	if len(requiredEntries) == 0 {
		return nil
	}

	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open %s as OpenXML zip: %w", path, err)
	}
	defer reader.Close()

	entries := map[string]*zip.File{}
	for _, file := range reader.File {
		entries[openXMLZipPartName(file.Name)] = file
	}
	if name := forbiddenOpenXMLZipPart(entries); name != "" {
		return fmt.Errorf("macro-enabled OpenXML part %s is not allowed", name)
	}
	for _, name := range requiredEntries {
		if entries[name] == nil {
			return fmt.Errorf("missing OpenXML entry %s", name)
		}
	}

	contentTypes, err := readZipTextEntry(entries["[Content_Types].xml"])
	if err != nil {
		return err
	}
	if err := validateOpenXMLContentTypes(contentTypes, format); err != nil {
		return err
	}

	return nil
}

func requiredOpenXMLEntries(format string) []string {
	switch normalizeFormat(format) {
	case "docx":
		return []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml"}
	case "xlsx":
		return []string{"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"}
	case "pptx":
		return []string{"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"}
	default:
		return nil
	}
}

func requiredOpenXMLMainPart(format string) string {
	switch normalizeFormat(format) {
	case "docx":
		return "word/document.xml"
	case "xlsx":
		return "xl/workbook.xml"
	case "pptx":
		return "ppt/presentation.xml"
	default:
		return ""
	}
}

func requiredOpenXMLContentType(format string) string {
	switch normalizeFormat(format) {
	case "docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
	case "xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
	case "pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
	default:
		return ""
	}
}

func readZipTextEntry(file *zip.File) (string, error) {
	if file == nil {
		return "", fmt.Errorf("missing OpenXML entry [Content_Types].xml")
	}
	stream, err := file.Open()
	if err != nil {
		return "", fmt.Errorf("open OpenXML entry %s: %w", file.Name, err)
	}
	defer stream.Close()
	bytes, err := io.ReadAll(io.LimitReader(stream, 1<<20))
	if err != nil {
		return "", fmt.Errorf("read OpenXML entry %s: %w", file.Name, err)
	}
	return string(bytes), nil
}

type openXMLContentTypeOverride struct {
	PartName    string
	ContentType string
}

func validateOpenXMLContentTypes(contentTypes string, format string) error {
	overrides, err := parseOpenXMLContentTypeOverrides(contentTypes)
	if err != nil {
		return err
	}
	if partName, contentType := forbiddenOpenXMLContentType(overrides); contentType != "" {
		return fmt.Errorf("macro-enabled OpenXML content type %s is not allowed for %s", contentType, partName)
	}

	mainPart := openXMLContentTypePartName(requiredOpenXMLMainPart(format))
	contentType := requiredOpenXMLContentType(format)
	if mainPart == "" || contentType == "" {
		return nil
	}
	for _, override := range overrides {
		if openXMLContentTypePartName(override.PartName) == mainPart && strings.EqualFold(strings.TrimSpace(override.ContentType), contentType) {
			return nil
		}
	}
	return fmt.Errorf("missing OpenXML content type %s for %s", contentType, mainPart)
}

func parseOpenXMLContentTypeOverrides(contentTypes string) ([]openXMLContentTypeOverride, error) {
	decoder := xml.NewDecoder(strings.NewReader(contentTypes))
	var overrides []openXMLContentTypeOverride
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse OpenXML content types: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "Override" {
			continue
		}
		var override openXMLContentTypeOverride
		for _, attr := range start.Attr {
			switch attr.Name.Local {
			case "PartName":
				override.PartName = strings.TrimSpace(attr.Value)
			case "ContentType":
				override.ContentType = strings.TrimSpace(attr.Value)
			}
		}
		overrides = append(overrides, override)
	}
	return overrides, nil
}

func forbiddenOpenXMLContentType(overrides []openXMLContentTypeOverride) (string, string) {
	for _, override := range overrides {
		if isForbiddenOpenXMLContentType(override.ContentType) {
			return openXMLContentTypePartName(override.PartName), override.ContentType
		}
	}
	return "", ""
}

func isForbiddenOpenXMLContentType(contentType string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(contentType), " ", ""))
	return strings.Contains(normalized, "macroenabled") ||
		strings.Contains(normalized, "vbaproject") ||
		strings.Contains(normalized, "vbadata")
}

func forbiddenOpenXMLZipPart(entries map[string]*zip.File) string {
	for name := range entries {
		normalized := strings.ToLower(openXMLZipPartName(name))
		if normalized == "vbaproject.bin" ||
			normalized == "vbaproject.bin.rels" ||
			normalized == "vbadata.xml" ||
			strings.HasSuffix(normalized, "/vbaproject.bin") ||
			strings.HasSuffix(normalized, "/vbaproject.bin.rels") ||
			strings.HasSuffix(normalized, "/vbadata.xml") {
			return name
		}
	}
	return ""
}

func openXMLContentTypePartName(partName string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(partName, "\\", "/"))
	if normalized == "" {
		return ""
	}
	if !strings.HasPrefix(normalized, "/") {
		normalized = "/" + normalized
	}
	return normalized
}

func openXMLValidationFailureResult(result Result, outputPath string, err error) Result {
	result.OK = false
	result.OutputPath = ""
	result.ErrorCode = ErrorCodeConversionFailed
	result.ErrorMessage = fmt.Sprintf("converted output failed OpenXML validation for %s: %v", outputPath, err)
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	return result
}

func openXMLZipPartName(name string) string {
	return strings.ReplaceAll(name, "\\", "/")
}
